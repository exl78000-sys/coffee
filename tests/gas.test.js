const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const FakeSheets = require('./fake-sheets.js');

function server() {
  const ctx = vm.createContext({});
  const store = FakeSheets.install(ctx, {}, vm.runInContext('Date', ctx));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/Code.gs'), 'utf8'), ctx);
  // 跟 google.script.run 一樣，參數與回傳值都經過序列化
  const json = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const gs = new Proxy({}, { get: (_, name) => (...args) => json(ctx[name](...json(args))) });
  return { gs, store, ctx };
}

const COLS = [{ header: 'id', text: true }, { header: '名稱', text: true }, { header: '烘焙日', text: true }, { header: '重量 g' }];

test('新增後讀回，文字欄不會被轉成日期或數字', () => {
  const { gs } = server();
  gs.saveRecords('beans', COLS, [{ id: 'b1', 名稱: '肯亞 AA', 烘焙日: '2026-10-01', '重量 g': 200 }]);
  const all = gs.loadAll();
  assert.deepEqual(all.beans[0], ['id', '名稱', '烘焙日', '重量 g']);
  assert.deepEqual(all.beans[1], ['b1', '肯亞 AA', '2026-10-01', 200]);
  assert.deepEqual(all.grinders, []);
});

test('以 id 更新同一列，並保留使用者自己加的欄位', () => {
  const { gs, store } = server();
  gs.saveRecords('beans', COLS, [{ id: 'b1', 名稱: 'A' }, { id: 'b2', 名稱: 'B' }]);
  // 使用者在試算表加了一欄「購買地點」
  const sheet = store.sheets['豆子'];
  sheet.cells[0][4] = '購買地點';
  sheet.cells[2][4] = '市集';
  gs.saveRecords('beans', COLS, [{ id: 'b2', 名稱: 'B2', '重量 g': 250 }]);
  const rows = gs.loadAll().beans;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[2], ['b2', 'B2', '', 250, '市集']);
});

test('新欄位會加在表頭最右邊', () => {
  const { gs } = server();
  gs.saveRecords('beans', COLS, [{ id: 'b1', 名稱: 'A' }]);
  gs.saveRecords('beans', COLS.concat([{ header: '備註', text: true }]), [{ id: 'b1', 備註: '好喝' }]);
  const rows = gs.loadAll().beans;
  assert.deepEqual(rows[0], ['id', '名稱', '烘焙日', '重量 g', '備註']);
  assert.equal(rows[1][4], '好喝');
});

test('刪除與清除', () => {
  const { gs } = server();
  gs.saveRecords('brews', [{ header: 'id', text: true }], [{ id: 'x' }, { id: 'y' }, { id: 'z' }]);
  assert.equal(gs.deleteRecords('brews', ['x', 'z']), 2);
  assert.deepEqual(gs.loadAll().brews.slice(1).map((r) => r[0]), ['y']);
  gs.clearAll();
  assert.deepEqual(gs.loadAll().brews, [['id']]);
});

test('試算表裡手動輸入的日期轉成文字', () => {
  const { gs, store } = server();
  gs.saveRecords('beans', [{ header: 'id', text: true }, { header: '烘焙日' }], [{ id: 'b1', 烘焙日: '2026-09-28' }]);
  assert.equal(typeof store.sheets['豆子'].cells[1][1], 'object');
  assert.equal(gs.loadAll().beans[1][1], '2026-09-28');
});

test('照片切格存放並完整讀回', () => {
  const { gs, store } = server();
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(120000);
  const id = gs.savePhoto(big);
  assert.ok(store.sheets['_照片'].hidden);
  assert.equal(store.sheets['_照片'].cells[0].length, 4);
  assert.equal(gs.getPhoto(id), big);
  assert.equal(gs.getPhoto('none'), '');
  assert.equal(gs.deletePhoto(id), true);
  assert.equal(gs.getPhoto(id), '');
  assert.throws(() => gs.savePhoto('javascript:alert(1)'));
});

test('doGet 從 GitHub 載入頁面並快取，refresh=1 重新抓', () => {
  const { ctx, store } = server();
  const big = '<!DOCTYPE html>' + '咖'.repeat(70000) + 'a'.repeat(50000);
  store.response = { code: 200, body: big };
  const first = ctx.doGet({ parameter: {} });
  assert.equal(first.html, big);
  assert.equal(first.title, '咖啡沖煮記錄');
  assert.equal(ctx.doGet({ parameter: {} }).html, big);
  assert.equal(store.fetches, 1, '第二次用快取');
  store.response = { code: 200, body: '<p>new</p>' };
  assert.equal(ctx.doGet({ parameter: { refresh: '1' } }).html, '<p>new</p>');
  assert.equal(store.fetches, 2);
});

test('doGet 抓不到時顯示說明', () => {
  const { ctx, store } = server();
  store.response = { code: 404, body: 'Not Found' };
  const out = ctx.doGet({ parameter: {} });
  assert.ok(out.html.includes('無法從 GitHub 載入 App') && out.html.includes('HTTP 404'));
});
