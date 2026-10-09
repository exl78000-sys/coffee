/**
 * 咖啡沖煮記錄 — Google 試算表後端（Google Apps Script）
 *
 * 資料存在這份試算表：
 *   「豆子」「磨豆機」「沖煮記錄」三個分頁，一列一筆，可以直接打開查看
 *   「_照片」隱藏分頁存豆子照片（切成多格存放）
 *
 * 安裝方式見 README「存到 Google 試算表」。
 *
 * @OnlyCurrentDoc 只要求存取這一份試算表的權限
 */

const TABS = { beans: '豆子', grinders: '磨豆機', brews: '沖煮記錄' };
const PHOTO_TAB = '_照片';
const CHUNK = 45000; // 單一儲存格上限 50,000 字

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('咖啡沖煮記錄')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function book_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('找不到試算表：請從試算表的「擴充功能 → Apps Script」建立這個程式。');
  return ss;
}

function withLock_(fn) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** 試算表裡手動輸入的日期會是 Date，轉成文字再傳給網頁 */
function cell_(v, tz) {
  if (v instanceof Date) {
    const hm = Utilities.formatDate(v, tz, 'HH:mm');
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd') + (hm === '00:00' ? '' : ' ' + hm);
  }
  return v;
}

function getSheetUrl() {
  return book_().getUrl();
}

/** 讀取三個分頁的所有內容（含表頭列） */
function loadAll() {
  const ss = book_();
  const tz = ss.getSpreadsheetTimeZone();
  const out = {};
  Object.keys(TABS).forEach(function (key) {
    const sh = ss.getSheetByName(TABS[key]);
    if (!sh || sh.getLastRow() < 1 || sh.getLastColumn() < 1) {
      out[key] = [];
      return;
    }
    out[key] = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues()
      .map(function (row) { return row.map(function (v) { return cell_(v, tz); }); });
  });
  return out;
}

/**
 * 確保需要的欄位都在表頭；沒有的加在最右邊（文字欄設成純文字格式，避免被轉成日期或數字）。
 * 回傳 { 表頭: 欄號 }。使用者自己加的欄位會保留。
 */
function headers_(sh, columns) {
  const last = sh.getLastColumn();
  const existing = last ? sh.getRange(1, 1, 1, last).getValues()[0].map(String) : [];
  const map = {};
  existing.forEach(function (h, i) { if (h) map[h] = i + 1; });
  let next = existing.length;
  columns.forEach(function (c) {
    if (map[c.header]) return;
    next++;
    if (next > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), next - sh.getMaxColumns());
    if (c.text) sh.getRange(1, next, sh.getMaxRows(), 1).setNumberFormat('@');
    sh.getRange(1, next).setValue(c.header).setFontWeight('bold');
    map[c.header] = next;
  });
  if (!existing.length) sh.setFrozenRows(1);
  return map;
}

function sheetFor_(tab) {
  const ss = book_();
  return ss.getSheetByName(TABS[tab]) || ss.insertSheet(TABS[tab]);
}

function rowIds_(sh, idCol) {
  const last = sh.getLastRow();
  return last > 1 ? sh.getRange(2, idCol, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
}

/**
 * 新增或更新多筆資料。records 是 { 表頭: 值 } 的陣列，以「id」欄比對。
 * 只寫入有傳的欄位，其他欄（包含使用者自己加的欄）保持原樣。
 */
function saveRecords(tab, columns, records) {
  if (!TABS[tab]) throw new Error('未知的分頁：' + tab);
  return withLock_(function () {
    const sh = sheetFor_(tab);
    const map = headers_(sh, columns);
    const width = sh.getLastColumn();
    const ids = rowIds_(sh, map.id);
    records.forEach(function (rec) {
      const at = ids.indexOf(String(rec.id));
      const row = at >= 0 ? sh.getRange(at + 2, 1, 1, width).getValues()[0] : new Array(width).fill('');
      Object.keys(rec).forEach(function (h) {
        if (map[h]) row[map[h] - 1] = rec[h] === null || rec[h] === undefined ? '' : rec[h];
      });
      if (at >= 0) {
        sh.getRange(at + 2, 1, 1, width).setValues([row]);
      } else {
        sh.appendRow(row);
        ids.push(String(rec.id));
      }
    });
    return records.length;
  });
}

function deleteRecords(tab, ids) {
  if (!TABS[tab]) throw new Error('未知的分頁：' + tab);
  return withLock_(function () {
    const sh = book_().getSheetByName(TABS[tab]);
    if (!sh || sh.getLastRow() < 2) return 0;
    const map = headers_(sh, []);
    if (!map.id) return 0;
    const all = rowIds_(sh, map.id);
    const rows = [];
    all.forEach(function (id, i) { if (ids.indexOf(id) >= 0) rows.push(i + 2); });
    rows.reverse().forEach(function (r) { sh.deleteRow(r); });
    return rows.length;
  });
}

/** 清除所有資料列（保留表頭與分頁） */
function clearAll() {
  return withLock_(function () {
    const ss = book_();
    Object.keys(TABS).map(function (k) { return TABS[k]; }).concat([PHOTO_TAB]).forEach(function (name) {
      const sh = ss.getSheetByName(name);
      if (!sh) return;
      const first = name === PHOTO_TAB ? 1 : 2;
      if (sh.getLastRow() >= first) sh.deleteRows(first, sh.getLastRow() - first + 1);
    });
    return true;
  });
}

// ---------- 照片 ----------

function photoSheet_() {
  const ss = book_();
  let sh = ss.getSheetByName(PHOTO_TAB);
  if (!sh) {
    sh = ss.insertSheet(PHOTO_TAB);
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
    sh.hideSheet();
  }
  return sh;
}

function photoRow_(sh, id) {
  const last = sh.getLastRow();
  if (!last) return -1;
  const ids = sh.getRange(1, 1, last, 1).getValues().map(function (r) { return String(r[0]); });
  const i = ids.indexOf(String(id));
  return i >= 0 ? i + 1 : -1;
}

/** 存一張照片（data URL），回傳照片編號 */
function savePhoto(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/') !== 0) throw new Error('照片格式不正確');
  return withLock_(function () {
    const sh = photoSheet_();
    const id = Utilities.getUuid();
    const row = [id];
    for (let i = 0; i < dataUrl.length; i += CHUNK) row.push(dataUrl.slice(i, i + CHUNK));
    if (row.length > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), row.length - sh.getMaxColumns());
    sh.getRange(1, 1, sh.getMaxRows(), row.length).setNumberFormat('@');
    sh.appendRow(row);
    return id;
  });
}

function getPhoto(id) {
  const sh = book_().getSheetByName(PHOTO_TAB);
  if (!sh) return '';
  const r = photoRow_(sh, id);
  if (r < 0) return '';
  return sh.getRange(r, 2, 1, Math.max(1, sh.getLastColumn() - 1)).getValues()[0].join('');
}

function deletePhoto(id) {
  return withLock_(function () {
    const sh = book_().getSheetByName(PHOTO_TAB);
    if (!sh) return false;
    const r = photoRow_(sh, id);
    if (r > 0) sh.deleteRow(r);
    return r > 0;
  });
}
