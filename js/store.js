/*
 * 資料層。三種後端：
 *   - sheet：Google 試算表（App 由 Google Apps Script 提供時）。三個分頁一列一筆，欄位可直接閱讀
 *   - db：claude.ai 頁面的雲端資料庫（每筆資料一份文件：beans/<id>、grinders/<id>、brews/<id>）
 *   - local：瀏覽器 localStorage（直接開檔 / 一般網址）
 * 讀取一律走記憶體中的 state，寫入時同步存回後端。
 */
(function (root) {
  'use strict';

  const KEY = 'coffee-log-v1';
  const COLLECTIONS = ['beans', 'grinders', 'brews'];
  const MODE = root.COFFEE_MODE || 'web';

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

  // ---------- Google 試算表欄位對應 ----------

  const METHOD_LABELS = { pourover: '手沖', immersion: '浸泡式', espresso: '義式', moka: '摩卡壺' };
  const EXTRA = '其他資料（請勿修改）';

  // [欄位, 表頭, 型別]；型別：text（預設）、num、bool、method、date、day；derived:* 為唯讀摘要欄
  const SHEET_COLUMNS = {
    beans: [
      ['id', 'id'], ['name', '名稱'], ['roaster', '烘豆商'], ['origin', '產區'], ['variety', '品種'],
      ['process', '處理法'], ['roast', '烘焙度'], ['roastDate', '烘焙日', 'day'], ['weight', '重量 g', 'num'],
      ['price', '價格'], ['flavor', '風味標示'], ['notes', '備註'], ['archived', '已喝完', 'bool'],
    ],
    grinders: [
      ['id', 'id'], ['name', '名稱'], ['unit', '刻度單位'], ['micronsPerStep', '每格 µm', 'num'],
      ['zeroMicrons', '零點 µm', 'num'], ['precision', '刻度精度', 'num'], ['notes', '備註'],
    ],
    brews: [
      ['id', 'id'], ['date', '日期', 'date'], ['method', '沖煮法', 'method'], [null, '豆子', 'derived:bean'],
      [null, '磨豆機', 'derived:grinder'], ['grindSetting', '刻度'], ['dose', '粉量 g', 'num'],
      ['ratio', '水粉比 1:', 'num'], ['water', '水量 g', 'num'], ['yield', '萃取量 g', 'num'],
      ['temp', '水溫 °C', 'num'], ['totalTime', '總時間'], [null, '分段', 'derived:stages'], ['dripper', '器具'],
      ['rating', '評分', 'num'], ['acidity', '酸', 'num'], ['sweetness', '甜', 'num'], ['bitterness', '苦', 'num'],
      ['body', '醇厚', 'num'], ['flavorNotes', '風味描述'], ['notes', '心得'], ['nextTime', '下次調整'],
      ['isBest', '最佳配方', 'bool'], ['recipeName', '參考配方'],
    ],
  };

  function sheetColumns(collection) {
    return SHEET_COLUMNS[collection].map(([, header, type]) => ({ header, text: type !== 'num' }))
      .concat([{ header: EXTRA, text: true }]);
  }

  function fmtSec(sec) {
    return Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0');
  }

  /** 記錄 → { 表頭: 值 }。對應不到欄位的資料（分段、器材細節等）放進最後的 JSON 欄 */
  function toRow(collection, obj, state) {
    const row = {};
    const extra = plain(obj);
    SHEET_COLUMNS[collection].forEach(([key, header, type]) => {
      if (!key) {
        if (type === 'derived:bean') {
          const b = state.beans.find((x) => x.id === obj.beanId);
          row[header] = b ? b.name : obj.beanName || '';
        } else if (type === 'derived:grinder') {
          const g = state.grinders.find((x) => x.id === obj.grinderId);
          row[header] = g ? g.name : obj.grinderName || '';
        } else if (type === 'derived:stages') {
          row[header] = (obj.stages || []).map((s, i) =>
            `${i + 1}. ${s.amount ? s.amount + 'g' : '—'}${typeof s.end === 'number' ? ' → ' + fmtSec(s.end) : ''}${s.technique ? ' ' + s.technique : ''}`).join('\n');
        }
        return;
      }
      const v = obj[key];
      delete extra[key];
      if (type === 'bool') row[header] = v ? '是' : '';
      else if (type === 'method') row[header] = METHOD_LABELS[v] || v || '';
      else if (type === 'date') row[header] = v ? String(v).replace('T', ' ') : '';
      else row[header] = v === null || v === undefined ? '' : v;
    });
    delete extra.photo; // 照片另存，不放進儲存格
    row[EXTRA] = JSON.stringify(extra);
    return row;
  }

  /** 試算表的一列 → 記錄；使用者在試算表裡改過的欄位以試算表為準 */
  function fromRow(collection, headers, values) {
    const at = {};
    headers.forEach((h, i) => { at[String(h)] = i; });
    const cell = (h) => (at[h] === undefined ? undefined : values[at[h]]);
    const id = String(cell('id') || '').trim();
    if (!id) return null;
    let obj = {};
    try { obj = JSON.parse(cell(EXTRA) || '{}') || {}; } catch (e) { obj = {}; }
    obj.id = id;
    SHEET_COLUMNS[collection].forEach(([key, header, type]) => {
      if (!key || key === 'id') return;
      const v = cell(header);
      if (v === undefined) return; // 欄位被刪掉：保留 JSON 裡的值
      if (v === '' || v === null) { delete obj[key]; return; }
      const t = String(v).trim();
      if (type === 'num') {
        const n = typeof v === 'number' ? v : parseFloat(t.replace(',', '.'));
        if (Number.isFinite(n)) obj[key] = n; else delete obj[key];
      } else if (type === 'bool') {
        obj[key] = !['', '否', 'false', 'FALSE', '0'].includes(t);
      } else if (type === 'method') {
        obj[key] = Object.keys(METHOD_LABELS).find((k) => METHOD_LABELS[k] === t) || (METHOD_LABELS[t] ? t : obj.method || 'pourover');
      } else if (type === 'date') {
        obj[key] = t.length <= 10 ? t.slice(0, 10) + 'T00:00' : t.replace(' ', 'T').slice(0, 16);
      } else if (type === 'day') {
        obj[key] = t.slice(0, 10);
      } else {
        obj[key] = t;
      }
    });
    return obj;
  }

  function parseSheets(data) {
    const s = empty();
    COLLECTIONS.forEach((c) => {
      const rows = (data && data[c]) || [];
      if (!rows.length) return;
      const headers = rows[0];
      s[c] = rows.slice(1).map((r) => fromRow(c, headers, r)).filter(Boolean);
    });
    return s;
  }

  /** 呼叫 Apps Script 伺服器端函式 */
  function gas(fn, ...args) {
    return new Promise((resolve, reject) => {
      root.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...args);
    });
  }

  /** 等待 claude.ai 頁面提供的 window.claude（一般網頁上不存在，直接回傳 null） */
  async function claudeDb() {
    if (MODE !== 'claude') return null;
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
    gas,

    async init() {
      if (MODE === 'gas' && root.google && root.google.script) {
        try {
          this.state = parseSheets(await gas('loadAll'));
          this.backend = 'sheet';
          return;
        } catch (e) {
          this.onError('讀取 Google 試算表失敗：' + ((e && e.message) || e));
        }
      }
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

    /** 同一份資料的寫入依序執行，避免互相覆蓋 */
    queue(path, fn) {
      const prev = this.chains[path] || Promise.resolve();
      const next = prev.then(fn).catch((e) => {
        const code = e && e.code;
        this.onError(code === 'quota_exceeded' ? '雲端空間已滿，請刪除一些舊記錄。' : '儲存失敗：' + ((e && e.message) || code || e));
      });
      this.chains[path] = next;
      return next;
    },

    persist(collection, obj) {
      if (this.backend === 'sheet') {
        const row = toRow(collection, obj, this.state);
        return this.queue(collection + '/' + obj.id, () => gas('saveRecords', collection, sheetColumns(collection), [row]));
      }
      if (this.backend !== 'db') return this.saveLocal();
      const data = plain(obj);
      return this.queue(collection + '/' + obj.id, () => this.db.doc(collection + '/' + obj.id).set(data));
    },

    /** 多筆一次寫入（試算表一次呼叫；其他後端逐筆） */
    persistMany(collection, list) {
      if (!list.length) return Promise.resolve();
      if (this.backend === 'sheet') {
        const rows = list.map((o) => toRow(collection, o, this.state));
        return this.queue(collection + '/*', () => gas('saveRecords', collection, sheetColumns(collection), rows));
      }
      list.forEach((o) => this.persist(collection, o));
      return this.flush();
    },

    unpersist(collection, id) {
      if (this.backend === 'sheet') return this.queue(collection + '/' + id, () => gas('deleteRecords', collection, [id]));
      if (this.backend !== 'db') return this.saveLocal();
      return this.queue(collection + '/' + id, () => this.db.doc(collection + '/' + id).delete());
    },

    /** 等待所有尚未完成的寫入 */
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
      const renamed = i >= 0 && list[i].name !== obj.name;
      if (i >= 0) list[i] = obj;
      else list.push(obj);
      this.persist(collection, obj);
      // 試算表的記錄列會顯示豆子 / 磨豆機名稱，改名時一併更新
      if (renamed && this.backend === 'sheet' && (collection === 'beans' || collection === 'grinders')) {
        const key = collection === 'beans' ? 'beanId' : 'grinderId';
        this.persistMany('brews', this.state.brews.filter((b) => b[key] === obj.id));
      }
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
      const changed = [];
      this.state.brews.forEach((b) => {
        if (b.beanId === brew.beanId && b.method === brew.method && b.isBest && b !== brew) {
          b.isBest = false;
          changed.push(b);
        }
      });
      brew.isBest = next;
      changed.push(brew);
      this.persistMany('brews', changed);
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
      if (this.backend === 'sheet') {
        // 一般網頁版備份裡的照片是 data URL，改存到試算表的照片分頁
        for (const b of incoming.beans) {
          if (b.photo && String(b.photo).startsWith('data:image/')) {
            try { b.photoKey = await gas('savePhoto', b.photo); } catch (e) { /* 略過照片 */ }
            delete b.photo;
          }
        }
        if (mode === 'replace') { await gas('clearAll'); this.state = empty(); }
      } else if (mode === 'replace') {
        COLLECTIONS.forEach((c) => {
          this.state[c].forEach((x) => { if (!incoming[c].some((y) => y.id === x.id)) this.unpersist(c, x.id); });
        });
      }
      COLLECTIONS.forEach((c) => {
        const map = new Map((mode === 'replace' ? [] : this.state[c]).map((x) => [x.id, x]));
        incoming[c].forEach((x) => map.set(x.id, x));
        this.state[c] = Array.from(map.values());
      });
      if (this.backend === 'sheet') {
        for (const c of COLLECTIONS) await this.persistMany(c, incoming[c]);
      } else if (this.backend === 'db') {
        COLLECTIONS.forEach((c) => incoming[c].forEach((x) => this.persist(c, x)));
      } else {
        this.saveLocal();
      }
      await this.flush();
      return COLLECTIONS.reduce((n, c) => n + incoming[c].length, 0);
    },

    async clear() {
      if (this.backend === 'sheet') {
        await gas('clearAll');
      } else {
        COLLECTIONS.forEach((c) => this.state[c].forEach((x) => this.unpersist(c, x.id)));
      }
      this.state = empty();
      if (this.backend === 'local') this.saveLocal();
      await this.flush();
    },
  };

  // 測試用
  Store._sheet = { toRow, fromRow, parseSheets, SHEET_COLUMNS, EXTRA };
  root.Store = Store;
})(typeof self !== 'undefined' ? self : this);
