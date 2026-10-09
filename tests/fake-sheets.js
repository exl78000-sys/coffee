/*
 * 測試用的假 Google 試算表，只實作 gas/Code.gs 用到的 API。
 * 模擬一般格式儲存格會把「像日期 / 數字的文字」自動轉換，純文字（'@'）格式則原樣保存。
 * 同時支援 Node（module.exports）與瀏覽器（window.FakeSheets）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FakeSheets = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let DateImpl = Date; // 在 Node vm 裡跑時換成該環境的 Date，instanceof 才會成立

  function autoConvert(v) {
    if (typeof v !== 'string') return v;
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return new DateImpl(v.replace(' ', 'T'));
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  }

  function makeSheet(name, data) {
    // data: { cells: [[...]], text: {col: true}, maxRows, maxCols, hidden, frozen }
    data.cells = data.cells || [];
    data.text = data.text || {};
    data.maxRows = data.maxRows || 1000;
    data.maxCols = data.maxCols || 26;

    const get = (r, c) => (data.cells[r - 1] && data.cells[r - 1][c - 1] !== undefined ? data.cells[r - 1][c - 1] : '');
    const put = (r, c, v) => {
      if (r > data.maxRows || c > data.maxCols) throw new Error('Range out of bounds');
      while (data.cells.length < r) data.cells.push([]);
      const row = data.cells[r - 1];
      while (row.length < c) row.push('');
      row[c - 1] = v instanceof DateImpl || data.text[c] ? v : autoConvert(v);
    };

    function range(r, c, nr, nc) {
      nr = nr || 1;
      nc = nc || 1;
      if (r < 1 || c < 1 || r + nr - 1 > data.maxRows || c + nc - 1 > data.maxCols) throw new Error('Range out of bounds');
      const self = {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) row.push(get(r + i, c + j));
            out.push(row);
          }
          return out;
        },
        setValues(values) {
          if (values.length !== nr || values.some((v) => v.length !== nc)) throw new Error('size mismatch');
          values.forEach((row, i) => row.forEach((v, j) => put(r + i, c + j, v)));
          return self;
        },
        setValue(v) { put(r, c, v); return self; },
        setFontWeight() { return self; },
        setNumberFormat(f) {
          for (let j = 0; j < nc; j++) data.text[c + j] = f === '@';
          return self;
        },
      };
      return self;
    }

    const lastRow = () => {
      for (let i = data.cells.length; i > 0; i--) if (data.cells[i - 1].some((v) => v !== '')) return i;
      return 0;
    };

    return {
      getName: () => name,
      getLastRow: lastRow,
      getLastColumn() {
        let m = 0;
        data.cells.forEach((row) => row.forEach((v, j) => { if (v !== '' && j + 1 > m) m = j + 1; }));
        return m;
      },
      getMaxRows: () => data.maxRows,
      getMaxColumns: () => data.maxCols,
      insertColumnsAfter(after, n) { data.maxCols += n; },
      getRange: range,
      appendRow(values) {
        const r = lastRow() + 1;
        if (r > data.maxRows) data.maxRows = r;
        if (values.length > data.maxCols) data.maxCols = values.length;
        values.forEach((v, j) => put(r, j + 1, v));
      },
      deleteRow(r) { data.cells.splice(r - 1, 1); },
      deleteRows(r, n) { data.cells.splice(r - 1, n); },
      setFrozenRows(n) { data.frozen = n; },
      hideSheet() { data.hidden = true; },
    };
  }

  /** 建立假的全域物件：SpreadsheetApp、LockService、Utilities、HtmlService */
  function install(target, store, DateCtor) {
    // store: { sheets: { 名稱: data } }，可序列化存起來
    if (DateCtor) DateImpl = DateCtor;
    store.sheets = store.sheets || {};
    const ss = {
      getSheetByName: (n) => (store.sheets[n] ? makeSheet(n, store.sheets[n]) : null),
      insertSheet: (n) => { store.sheets[n] = {}; return makeSheet(n, store.sheets[n]); },
      getSpreadsheetTimeZone: () => 'Asia/Taipei',
      getUrl: () => 'https://docs.google.com/spreadsheets/d/fake/edit',
    };
    let uuid = 0;
    target.SpreadsheetApp = { getActiveSpreadsheet: () => ss };
    target.LockService = { getDocumentLock: () => ({ waitLock() {}, releaseLock() {} }) };
    target.Utilities = {
      getUuid: () => 'photo-' + Date.now().toString(36) + '-' + uuid++,
      formatDate(d, tz, fmt) {
        const p = (n) => String(n).padStart(2, '0');
        return fmt
          .replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate()))
          .replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes()));
      },
    };
    return store;
  }

  return { install, autoConvert };
});
