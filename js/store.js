/*
 * 資料層：存在瀏覽器 localStorage，可匯出 / 匯入 JSON 備份。
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

  function normalize(data) {
    const s = empty();
    if (data && typeof data === 'object') {
      COLLECTIONS.forEach((c) => {
        if (Array.isArray(data[c])) s[c] = data[c].filter((x) => x && x.id);
      });
    }
    return s;
  }

  const Store = {
    state: empty(),
    error: null,

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        this.state = raw ? normalize(JSON.parse(raw)) : empty();
      } catch (e) {
        this.error = e;
        this.state = empty();
      }
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {});
      }
      return this.state;
    },

    save() {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.state));
        this.error = null;
      } catch (e) {
        this.error = e;
        alert('儲存失敗：' + e.message + '\n建議先到「設定」匯出備份。');
      }
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
      this.save();
      return obj;
    },

    remove(collection, id) {
      this.state[collection] = this.state[collection].filter((x) => x.id !== id);
      this.save();
    },

    /** 同一支豆子、同一種沖煮法只保留一個「最佳配方」 */
    toggleBest(brewId) {
      const brew = this.get('brews', brewId);
      if (!brew) return;
      const next = !brew.isBest;
      this.state.brews.forEach((b) => {
        if (b.beanId === brew.beanId && b.method === brew.method) b.isBest = false;
      });
      brew.isBest = next;
      this.save();
    },

    exportJSON() {
      return JSON.stringify(
        Object.assign({ exportedAt: new Date().toISOString() }, this.state),
        null,
        2
      );
    },

    /** mode: 'merge'（同 id 以匯入檔為準）或 'replace'（整個取代） */
    importJSON(text, mode) {
      const incoming = normalize(JSON.parse(text));
      if (mode === 'replace') {
        this.state = incoming;
      } else {
        COLLECTIONS.forEach((c) => {
          const map = new Map(this.state[c].map((x) => [x.id, x]));
          incoming[c].forEach((x) => map.set(x.id, x));
          this.state[c] = Array.from(map.values());
        });
      }
      this.save();
      return COLLECTIONS.reduce((n, c) => n + incoming[c].length, 0);
    },

    clear() {
      this.state = empty();
      this.save();
    },
  };

  root.Store = Store;
})(self);
