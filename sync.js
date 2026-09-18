/* ============================================================
   VEDANT ENTERPRISES — MULTI-DEVICE REAL-TIME SYNC ENGINE
   ============================================================ */

const CLIENT_ID = 'dev_' + Math.random().toString(36).substr(2, 9);
const SYNC_URL_KEY = 'vedant_custom_sync_url_v1';

const SyncEngine = {
  status: 'connecting', // 'online', 'syncing', 'offline', 'connecting'
  lastSyncTime: null,
  localRevision: 0,
  serverRevision: 0,
  sseConnection: null,
  pollTimer: null,
  onRemoteUpdateCallback: null,

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

  init(onRemoteUpdate) {
    this.onRemoteUpdateCallback = onRemoteUpdate;
    this.connectSSE();
    this.initialFetch();
    this.startHeartbeat();
  },

  restart() {
    if (this.sseConnection) {
      try { this.sseConnection.close(); } catch(e){}
      this.sseConnection = null;
    }
    this.connectSSE();
    this.initialFetch();
  },

  async initialFetch() {
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

        // Check if server data should update local
        if (this.onRemoteUpdateCallback) {
          this.onRemoteUpdateCallback(json.data, false);
        }
      }
    } catch(e) {
      console.warn('Sync server initial fetch failed, running local cache:', e.message);
      this.updateStatus('offline');
    }
  },

  connectSSE() {
    if (typeof EventSource === 'undefined') return;
    const url = this.getServerUrl();

    try {
      if (this.sseConnection) {
        this.sseConnection.close();
      }

      const sse = new EventSource(`${url}/api/events`);
      this.sseConnection = sse;

      sse.onopen = () => {
        this.updateStatus('online');
      };

      sse.onmessage = (event) => {
        try {
          if (!event.data || event.data === ':ping' || event.data === ':keepalive') return;
          const payload = JSON.parse(event.data);

          if (payload.type === 'CONNECTED') {
            this.serverRevision = payload.revision || 1;
            this.updateStatus('online');
            if (payload.data && this.onRemoteUpdateCallback) {
              this.onRemoteUpdateCallback(payload.data, false);
            }
          } else if (payload.type === 'SYNC_UPDATE') {
            this.serverRevision = payload.revision || (this.serverRevision + 1);
            this.lastSyncTime = new Date();
            this.updateStatus('online');

            // Only apply if the update came from another device/client
            if (payload.senderClientId !== CLIENT_ID && payload.data) {
              if (this.onRemoteUpdateCallback) {
                this.onRemoteUpdateCallback(payload.data, true);
              }
            }
          }
        } catch(err) {
          console.error('SSE Message parsing error:', err);
        }
      };

      sse.onerror = () => {
        this.updateStatus('offline');
      };
    } catch(e) {
      this.updateStatus('offline');
    }
  },

  startHeartbeat() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      // Check status periodically if SSE disconnected or for background keepalive
      if (this.status === 'offline' || !this.sseConnection || this.sseConnection.readyState !== EventSource.OPEN) {
        const url = this.getServerUrl();
        try {
          const res = await fetch(`${url}/api/sync-status`, { cache: 'no-cache' });
          if (res.ok) {
            const json = await res.json();
            if (json.revision > this.serverRevision) {
              // Server has newer data, fetch it
              this.initialFetch();
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
    }, 6000);
  },

  async pushUpdate(data) {
    this.updateStatus('syncing');
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
          clientId: CLIENT_ID,
          timestamp: Date.now()
        })
      });

      if (!res.ok) throw new Error('Post failed');
      const json = await res.json();
      this.serverRevision = json.revision || (this.serverRevision + 1);
      this.lastSyncTime = new Date();
      this.updateStatus('online');
      return true;
    } catch(err) {
      console.warn('Could not push to sync server, saved locally:', err.message);
      this.updateStatus('offline');
      return false;
    }
  },

  updateStatus(newStatus) {
    this.status = newStatus;
    this.renderBadge();
  },

  renderBadge() {
    const el = document.getElementById('topbarSyncBadge');
    if (!el) return;

    let icon = '🟢';
    let text = 'सिंक चालू';
    let cls = 'sync-online';

    if (this.status === 'syncing') {
      icon = '🔄';
      text = 'सिंक होत आहे...';
      cls = 'sync-working';
    } else if (this.status === 'offline') {
      icon = '⚪';
      text = 'स्थानिक मोड (ऑफलाइन)';
      cls = 'sync-offline';
    } else if (this.status === 'connecting') {
      icon = '🟡';
      text = 'कनेक्ट करत आहे...';
      cls = 'sync-connecting';
    }

    const isMr = (typeof currentLang === 'undefined' || currentLang === 'mr');
    if (!isMr) {
      if (this.status === 'online') text = 'Live Synced';
      else if (this.status === 'syncing') text = 'Syncing...';
      else if (this.status === 'offline') text = 'Offline / Local';
      else text = 'Connecting...';
    }

    el.className = `sync-status-pill ${cls}`;
    el.innerHTML = `<span>${icon}</span> <span>${text}</span>`;
  }
};
