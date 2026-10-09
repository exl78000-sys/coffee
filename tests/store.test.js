const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../js/store.js');
const { toRow, parseSheets, SHEET_COLUMNS, EXTRA } = Store._sheet;

const state = {
  beans: [{ id: 'b1', name: '肯亞 AA' }],
  grinders: [{ id: 'g1', name: 'C40' }],
  brews: [],
};

function sheetOf(collection, objs) {
  const rows = objs.map((o) => toRow(collection, o, state));
  const headers = SHEET_COLUMNS[collection].map((c) => c[1]).concat([EXTRA]);
  return [headers].concat(rows.map((r) => headers.map((h) => (r[h] === undefined ? '' : r[h]))));
}

const brew = {
  id: 'r1', date: '2026-10-08T08:15', method: 'pourover', beanId: 'b1', grinderId: 'g1', grindSetting: '24',
  dose: 15, ratio: 16, water: 240, temp: 92, totalTime: '2:45', dripper: 'V60',
  stages: [{ amount: 40, end: 30, technique: '繞圈' }, { amount: 200, end: 120 }],
  rating: 4, acidity: 3, flavorNotes: '柑橘', isBest: true, filter: '錐形', createdAt: '2026-10-08T00:15:00Z',
};

test('記錄寫成可閱讀的列', () => {
  const row = toRow('brews', brew, state);
  assert.equal(row['日期'], '2026-10-08 08:15');
  assert.equal(row['沖煮法'], '手沖');
  assert.equal(row['豆子'], '肯亞 AA');
  assert.equal(row['磨豆機'], 'C40');
  assert.equal(row['粉量 g'], 15);
  assert.equal(row['分段'], '1. 40g → 0:30 繞圈\n2. 200g → 2:00');
  assert.equal(row['最佳配方'], '是');
  const extra = JSON.parse(row[EXTRA]);
  assert.deepEqual(extra.stages, brew.stages);
  assert.equal(extra.dose, undefined);
});

test('寫入再讀回內容不變', () => {
  const back = parseSheets({ brews: sheetOf('brews', [brew]), beans: sheetOf('beans', state.beans) });
  assert.deepEqual(back.brews[0], brew);
  assert.deepEqual(back.beans[0], { id: 'b1', name: '肯亞 AA' });
});

test('在試算表直接修改的欄位會被讀進來', () => {
  const sheet = sheetOf('brews', [brew]);
  const col = (h) => sheet[0].indexOf(h);
  sheet[1][col('粉量 g')] = '16';
  sheet[1][col('沖煮法')] = '義式';
  sheet[1][col('風味描述')] = '';
  sheet[1][col('最佳配方')] = '';
  sheet[1][col('日期')] = '2026-10-09';
  const b = parseSheets({ brews: sheet }).brews[0];
  assert.equal(b.dose, 16);
  assert.equal(b.method, 'espresso');
  assert.equal(b.flavorNotes, undefined);
  assert.ok(!b.isBest);
  assert.equal(b.date, '2026-10-09T00:00');
});

test('沒有 id 的列略過、欄位順序可以不同、被刪掉的欄沿用 JSON', () => {
  const sheet = sheetOf('beans', [{ id: 'b2', name: '巴西', weight: 250, roastDate: '2026-09-01' }]);
  // 欄位倒過來排，並刪掉「重量 g」欄
  const w = sheet[0].indexOf('重量 g');
  const shuffled = sheet.map((r) => r.filter((_, i) => i !== w).reverse());
  shuffled.push(shuffled[1].map(() => ''));
  const beans = parseSheets({ beans: shuffled }).beans;
  assert.equal(beans.length, 1);
  assert.equal(beans[0].name, '巴西');
  assert.equal(beans[0].roastDate, '2026-09-01');
});

test('照片 data URL 不會寫進儲存格', () => {
  const row = toRow('beans', { id: 'b3', name: 'x', photo: 'data:image/jpeg;base64,AAAA', photoKey: 'k1' }, state);
  const extra = JSON.parse(row[EXTRA]);
  assert.equal(extra.photo, undefined);
  assert.equal(extra.photoKey, 'k1');
});
