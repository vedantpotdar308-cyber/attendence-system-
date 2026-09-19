/* ============================================================
   VEDANT ENTERPRISES — FIREBASE CLOUD & MULTI-DEVICE SYNC ENGINE
   ============================================================ */

const CLIENT_ID = 'dev_' + Math.random().toString(36).substr(2, 9);
const SYNC_URL_KEY = 'vedant_custom_sync_url_v1';

// Official Firebase Project Configuration
const FIREBASE_CONFIG = {
  projectId: "vedant-enterprises-6544a",
  appId: "1:252321446989:web:260e87da5e25f9fff67004",
  storageBucket: "vedant-enterprises-6544a.firebasestorage.app",
  apiKey: "AIzaSyAPCCQY0Nq4SrdCVxiZocdWQ9CHNUAczt8",
  authDomain: "vedant-enterprises-6544a.firebaseapp.com",
  messagingSenderId: "252321446989",
  measurementId: "G-94MVM75B37"
};

const SyncEngine = {
  status: 'connecting', // 'online', 'syncing', 'offline', 'connecting'
  syncMode: 'cloud',    // 'cloud' (Firebase) or 'local' (Node Server)
  lastSyncTime: null,
  localRevision: 0,
  serverRevision: 0,
  firestoreDb: null,
  firestoreUnsub: null,
  sseConnection: null,
  pollTimer: null,
  onRemoteUpdateCallback: null,
  initialLocalData: null,

  getServerUrl() {
    const custom = localStorage.getItem(SYNC_URL_KEY);
    if (custom && custom.trim()) return custom.trim().replace(/\/+$/, '');
    if (window.location.protocol.startsWith('http')) {
      return window.location.origin;
    }
    return 'http://localhost:5000';
  },

  setServerUrl(url) {
    if (url && url.trim()) {
      localStorage.setItem(SYNC_URL_KEY, url.trim().replace(/\/+$/, ''));
    } else {
      localStorage.removeItem(SYNC_URL_KEY);
    }
    this.restart();
  },

  async init(onRemoteUpdate, initialData) {
    this.onRemoteUpdateCallback = onRemoteUpdate;
    if (initialData) this.initialLocalData = initialData;

    // 1. Initialize Firebase Cloud Sync
    const cloudStarted = await this.initFirebase();

    // 2. If Firebase is not available or failed, fallback to local server
    if (!cloudStarted) {
      this.syncMode = 'local';
      this.connectSSE();
      this.initialFetchLocal();
      this.startHeartbeat();
    }
  },

  async initFirebase() {
    if (typeof firebase === 'undefined' || !firebase.firestore) {
      console.log('Firebase SDK not present on window, using local sync mode.');
      return false;
    }

    try {
      this.updateStatus('connecting');
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      const db = firebase.firestore();
      this.firestoreDb = db;

      // Enable offline persistence in browser
      try {
        await db.enablePersistence({ synchronizeTabs: true });
      } catch (err) {
        if (err.code === 'failed-precondition') {
          console.warn('Firebase persistence failed: multiple tabs open');
        } else if (err.code === 'unimplemented') {
          console.warn('Firebase persistence not supported in this browser');
        }
      }

      const docRef = db.collection('vedant_attendance').doc('global_state');

      // Real-time listener across all devices over the cloud
      this.firestoreUnsub = docRef.onSnapshot({ includeMetadataChanges: true }, (docSnap) => {
        const fromCache = docSnap.metadata.fromCache;
        const hasPendingWrites = docSnap.metadata.hasPendingWrites;

        if (!docSnap.exists) {
          console.log('Firestore doc empty. Initializing from local storage...');
          if (this.initialLocalData) {
            this.pushUpdate(this.initialLocalData);
          }
          this.updateStatus('online');
          return;
        }

        const cloudData = docSnap.data();
        if (!cloudData || !cloudData.data) return;

        this.serverRevision = cloudData.revision || 1;
        this.lastSyncTime = new Date();
        this.syncMode = 'cloud';
        this.updateStatus(hasPendingWrites ? 'syncing' : 'online');

        // Ignore echo loop from this same client session
        if (cloudData.senderClientId === CLIENT_ID) {
          return;
        }

        // Trigger UI refresh callback with updated data from another device
        if (this.onRemoteUpdateCallback) {
          this.onRemoteUpdateCallback(cloudData.data, true);
        }
      }, (err) => {
        console.warn('Firebase Firestore listener error:', err);
        this.updateStatus('offline');
        // Fallback to local server connection if cloud is unreachable
        if (!this.sseConnection) {
          this.connectSSE();
          this.startHeartbeat();
        }
      });

      this.syncMode = 'cloud';
      return true;
    } catch (e) {
      console.error('Firebase initialization error:', e);
      return false;
    }
  },

  restart() {
    if (this.firestoreUnsub) {
      try { this.firestoreUnsub(); } catch(e){}
      this.firestoreUnsub = null;
    }
    if (this.sseConnection) {
      try { this.sseConnection.close(); } catch(e){}
      this.sseConnection = null;
    }
    this.init(this.onRemoteUpdateCallback, this.initialLocalData);
  },

  async pushUpdate(data) {
    this.updateStatus('syncing');
    this.localRevision++;
    const nextRevision = (this.serverRevision || 0) + 1;
    this.initialLocalData = data;

    let cloudOk = false;

    // 1. Push to Firebase Cloud (Firestore)
    if (this.firestoreDb) {
      try {
        const docRef = this.firestoreDb.collection('vedant_attendance').doc('global_state');
        await docRef.set({
          data: data,
          revision: nextRevision,
          senderClientId: CLIENT_ID,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        this.serverRevision = nextRevision;
        this.lastSyncTime = new Date();
        this.syncMode = 'cloud';
        this.updateStatus('online');
        cloudOk = true;
      } catch (err) {
        console.warn('Firebase write error:', err.message);
      }
    }

    // 2. Also mirror to local node server if running
    try {
      await this.pushToLocalServer(data, nextRevision);
    } catch(e) {}

    if (!cloudOk && this.syncMode !== 'local') {
      if (navigator.onLine) {
        this.updateStatus('online'); // IndexedDB persistence will sync
      } else {
        this.updateStatus('offline');
      }
    }

    return true;
  },

  async pushToLocalServer(data, rev) {
    const url = this.getServerUrl();
    try {
      const res = await fetch(`${url}/api/data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': CLIENT_ID
        },
        body: JSON.stringify({
          data: data,
          revision: rev || this.localRevision,
          clientId: CLIENT_ID,
          timestamp: Date.now()
        })
      });
      if (res.ok) {
        if (!this.firestoreDb) {
          const json = await res.json();
          this.serverRevision = json.revision || rev;
          this.lastSyncTime = new Date();
          this.syncMode = 'local';
          this.updateStatus('online');
        }
      }
    } catch (e) {
      // Local server might not be active, which is normal when using Firebase Cloud
    }
  },

  async initialFetchLocal() {
    const url = this.getServerUrl();
    try {
      this.updateStatus('syncing');
      const res = await fetch(`${url}/api/data`, { cache: 'no-cache' });
      if (!res.ok) throw new Error('Fetch failed');
      const json = await res.json();
      if (json && json.data) {
        this.serverRevision = json.revision || 1;
        this.lastSyncTime = new Date();
        this.updateStatus('online');
        if (this.onRemoteUpdateCallback) {
          this.onRemoteUpdateCallback(json.data, false);
        }
      }
    } catch(e) {
      this.updateStatus('offline');
    }
  },

  connectSSE() {
    if (typeof EventSource === 'undefined') return;
    const url = this.getServerUrl();
    try {
      if (this.sseConnection) this.sseConnection.close();
      const sse = new EventSource(`${url}/api/events`);
      this.sseConnection = sse;
      sse.onopen = () => { if (!this.firestoreDb) this.updateStatus('online'); };
      sse.onmessage = (event) => {
        try {
          if (!event.data || event.data.startsWith(':')) return;
          const payload = JSON.parse(event.data);
          if (payload.type === 'CONNECTED' && !this.firestoreDb) {
            this.serverRevision = payload.revision || 1;
            this.updateStatus('online');
            if (payload.data && this.onRemoteUpdateCallback) {
              this.onRemoteUpdateCallback(payload.data, false);
            }
          } else if (payload.type === 'SYNC_UPDATE' && !this.firestoreDb) {
            this.serverRevision = payload.revision || (this.serverRevision + 1);
            this.lastSyncTime = new Date();
            this.updateStatus('online');
            if (payload.senderClientId !== CLIENT_ID && payload.data && this.onRemoteUpdateCallback) {
              this.onRemoteUpdateCallback(payload.data, true);
            }
          }
        } catch(err){}
      };
      sse.onerror = () => { if (!this.firestoreDb) this.updateStatus('offline'); };
    } catch(e) {}
  },

  startHeartbeat() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      if (this.firestoreDb) return; // Firebase handles keepalive natively
      if (this.status === 'offline' || !this.sseConnection || this.sseConnection.readyState !== EventSource.OPEN) {
        const url = this.getServerUrl();
        try {
          const res = await fetch(`${url}/api/sync-status`, { cache: 'no-cache' });
          if (res.ok) {
            const json = await res.json();
            if (json.revision > this.serverRevision) {
              this.initialFetchLocal();
            } else {
              this.updateStatus('online');
            }
            if (!this.sseConnection || this.sseConnection.readyState === EventSource.CLOSED) {
              this.connectSSE();
            }
          }
        } catch(e) {
          this.updateStatus('offline');
        }
      }
    }, 8000);
  },

  updateStatus(newStatus) {
    this.status = newStatus;
    this.renderBadge();
  },

  renderBadge() {
    const el = document.getElementById('topbarSyncBadge');
    if (!el) return;

    const isCloud = (this.syncMode === 'cloud' && this.firestoreDb);
    const isMr = (typeof currentLang === 'undefined' || currentLang === 'mr');

    let icon = isCloud ? '☁️ 🟢' : '🟢';
    let text = isCloud ? (isMr ? 'क्लाउड सिंक चालू' : 'Cloud Synced') : (isMr ? 'सिंक चालू' : 'Live Synced');
    let cls = 'sync-online';

    if (this.status === 'syncing') {
      icon = isCloud ? '☁️ 🔄' : '🔄';
      text = isMr ? 'सिंक होत आहे...' : 'Syncing...';
      cls = 'sync-working';
    } else if (this.status === 'offline') {
      icon = '⚪';
      text = isMr ? 'स्थानिक मोड (ऑफलाइन)' : 'Offline / Local';
      cls = 'sync-offline';
    } else if (this.status === 'connecting') {
      icon = '🟡';
      text = isMr ? 'कनेक्ट करत आहे...' : 'Connecting...';
      cls = 'sync-connecting';
    }

    el.className = `sync-status-pill ${cls}`;
    el.innerHTML = `<span>${icon}</span> <span>${text}</span>`;
  }
};
