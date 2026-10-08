/*
 * 資料層。兩種後端：
 *   - local：瀏覽器 localStorage（一般網址 / GitHub Pages / 直接開檔）
 *   - db：claude.ai 頁面的雲端資料庫（每筆資料一份文件：beans/<id>、grinders/<id>、brews/<id>）
 * 讀取一律走記憶體中的 state，寫入時同步存回後端。
 */
(function (root) {
  'use strict';

  const KEY = 'coffee-log-v1';
  const COLLECTIONS = ['beans', 'grinders', 'brews'];

  function empty() {
    return { version: 1, beans: [], grinders: [], brews: [] };
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function plain(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function normalize(data) {
    const s = empty();
    if (data && typeof data === 'object') {
      COLLECTIONS.forEach((c) => {
        if (Array.isArray(data[c])) s[c] = data[c].filter((x) => x && x.id && /^[A-Za-z0-9_.~:@+-]+$/.test(x.id));
      });
    }
    return s;
  }

  /** 等待 claude.ai 頁面提供的 window.claude（一般網頁上不存在，直接回傳 null） */
  async function claudeDb() {
    if (!root.COFFEE_EMBED) return null;
    for (let i = 0; i < 20 && !(root.claude && root.claude.use); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!(root.claude && root.claude.use)) return null;
    try { return await root.claude.use('db'); } catch (e) { return null; }
  }

  const Store = {
    state: empty(),
    backend: 'local',
    db: null,
    /** 寫入失敗時呼叫，由畫面層設定 */
    onError: (msg) => console.error(msg),
    chains: {},

    async init() {
      const db = await claudeDb();
      if (db) {
        try {
          const s = empty();
          for (const c of COLLECTIONS) {
            const snap = await db.collection(c).limit(1000).get();
            s[c] = snap.docs.map((d) => plain(d.data()));
          }
          this.state = s;
          this.db = db;
          this.backend = 'db';
          return;
        } catch (e) {
          this.onError('雲端資料載入失敗，暫時改用這台裝置的瀏覽器儲存。');
        }
      }
      this.loadLocal();
    },

    loadLocal() {
      try {
        const raw = localStorage.getItem(KEY);
        this.state = raw ? normalize(JSON.parse(raw)) : empty();
      } catch (e) {
        this.state = empty();
      }
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {});
      }
    },

    saveLocal() {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.state));
      } catch (e) {
        this.onError('儲存失敗：' + e.message + '。建議先到「設定」匯出備份。');
      }
    },

    /** 同一份文件的寫入依序執行，避免互相覆蓋 */
    queue(path, fn) {
      const prev = this.chains[path] || Promise.resolve();
      const next = prev.then(fn).catch((e) => {
        const code = e && e.code;
        this.onError(code === 'quota_exceeded' ? '雲端空間已滿，請刪除一些舊記錄。' : '雲端儲存失敗：' + ((e && e.message) || code || e));
      });
      this.chains[path] = next;
      return next;
    },

    persist(collection, obj) {
      if (this.backend !== 'db') return this.saveLocal();
      const data = plain(obj);
      return this.queue(collection + '/' + obj.id, () => this.db.doc(collection + '/' + obj.id).set(data));
    },

    unpersist(collection, id) {
      if (this.backend !== 'db') return this.saveLocal();
      return this.queue(collection + '/' + id, () => this.db.doc(collection + '/' + id).delete());
    },

    /** 等待所有尚未完成的雲端寫入 */
    flush() {
      return Promise.all(Object.values(this.chains));
    },

    uid,

    all(collection) {
      return this.state[collection];
    },

    get(collection, id) {
      return this.state[collection].find((x) => x.id === id) || null;
    },

    upsert(collection, obj) {
      const list = this.state[collection];
      const now = new Date().toISOString();
      if (!obj.id) {
        obj.id = uid();
        obj.createdAt = now;
      }
      obj.updatedAt = now;
      const i = list.findIndex((x) => x.id === obj.id);
      if (i >= 0) list[i] = obj;
      else list.push(obj);
      this.persist(collection, obj);
      return obj;
    },

    remove(collection, id) {
      this.state[collection] = this.state[collection].filter((x) => x.id !== id);
      this.unpersist(collection, id);
    },

    /** 同一支豆子、同一種沖煮法只保留一個「最佳配方」 */
    toggleBest(brewId) {
      const brew = this.get('brews', brewId);
      if (!brew) return;
      const next = !brew.isBest;
      this.state.brews.forEach((b) => {
        if (b.beanId === brew.beanId && b.method === brew.method && b.isBest && b !== brew) {
          b.isBest = false;
          this.persist('brews', b);
        }
      });
      brew.isBest = next;
      this.persist('brews', brew);
    },

    exportJSON() {
      return JSON.stringify(
        Object.assign({ exportedAt: new Date().toISOString() }, this.state),
        null,
        2
      );
    },

    /** mode: 'merge'（同 id 以匯入檔為準）或 'replace'（整個取代） */
    async importJSON(text, mode) {
      const incoming = normalize(JSON.parse(text));
      if (mode === 'replace') {
        COLLECTIONS.forEach((c) => {
          this.state[c].forEach((x) => { if (!incoming[c].some((y) => y.id === x.id)) this.unpersist(c, x.id); });
        });
      }
      COLLECTIONS.forEach((c) => {
        const map = new Map((mode === 'replace' ? [] : this.state[c]).map((x) => [x.id, x]));
        incoming[c].forEach((x) => { map.set(x.id, x); if (this.backend === 'db') this.persist(c, x); });
        this.state[c] = Array.from(map.values());
      });
      if (this.backend !== 'db') this.saveLocal();
      await this.flush();
      return COLLECTIONS.reduce((n, c) => n + incoming[c].length, 0);
    },

    async clear() {
      COLLECTIONS.forEach((c) => this.state[c].forEach((x) => this.unpersist(c, x.id)));
      this.state = empty();
      if (this.backend !== 'db') this.saveLocal();
      await this.flush();
    },
  };

  root.Store = Store;
})(self);
