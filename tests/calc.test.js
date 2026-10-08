const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');

test('parseTime / formatTime', () => {
  assert.equal(C.parseTime('2:30'), 150);
  assert.equal(C.parseTime('0:05'), 5);
  assert.equal(C.parseTime('2分30秒'), 150);
  assert.equal(C.parseTime('45'), 45);
  assert.equal(C.parseTime('28s'), 28);
  assert.equal(C.parseTime(''), null);
  assert.equal(C.parseTime('abc'), null);
  assert.equal(C.formatTime(150), '2:30');
  assert.equal(C.formatTime(5), '0:05');
  assert.equal(C.formatTime(null), '');
});

test('水粉比換算', () => {
  assert.equal(C.waterFromDose(15, 15), 225);
  assert.equal(C.waterFromDose(18, 2), 36);
  assert.equal(C.doseFromWater(300, 16), 18.8);
  assert.equal(C.ratioOf(15, 240), 16);
  assert.equal(C.ratioOf(0, 240), null);
  assert.equal(C.estimatedBeverage(240, 15), 210);
});

test('分段累計與縮放', () => {
  const stages = [{ amount: 30 }, { amount: 120 }, { amount: 75 }];
  assert.deepEqual(C.cumulative(stages), [30, 150, 225]);
  const scaled = C.scaleStages(stages, 300);
  assert.equal(C.stagesTotal(scaled), 300);
  assert.deepEqual(scaled.map((s) => s.amount), [40, 160, 100]);
  // 不能整除時，誤差補到最後一段，總和仍正確
  const odd = C.scaleStages(stages, 241);
  assert.equal(C.stagesTotal(odd), 241);
  // 原陣列不被修改
  assert.equal(stages[0].amount, 30);
});

test('沖煮範本總水量正確', () => {
  for (const key of Object.keys(C.POUR_TEMPLATES)) {
    const st = C.buildTemplate(key, 15, 240);
    assert.ok(st.length > 0, key);
    assert.equal(C.stagesTotal(st), 240, key);
  }
  assert.equal(C.buildTemplate('three', 15, 240)[0].amount, 30);
  assert.equal(C.buildTemplate('three', 15, 240)[0].end, 40);
});

test('計時器段落判斷（秒數為每段結束時間）', () => {
  const stages = [{ end: 40 }, { end: '1:20' }, { end: 120 }];
  assert.equal(C.stageIndexAt(stages, 0), 0);
  assert.equal(C.stageIndexAt(stages, 39), 0);
  assert.equal(C.stageIndexAt(stages, 40), 1);
  assert.equal(C.stageIndexAt(stages, 119), 2);
  assert.equal(C.stageIndexAt(stages, 120), 3);
  assert.equal(C.stageIndexAt([], 5), 0);
});

test('舊格式開始時間轉成結束秒數', () => {
  const old = [{ start: '0:00', amount: 30 }, { start: '0:40', amount: 120 }, { start: '1:20', amount: 90 }];
  const m = C.migrateStages(old, '2:45');
  assert.deepEqual(m.map((s) => s.end), [40, 80, 165]);
  assert.ok(m.every((s) => s.start === undefined));
  assert.deepEqual(C.migrateStages([{ start: '0:30' }]).map((s) => s.end), [60]);
  const fresh = [{ end: 30, amount: 20 }];
  assert.equal(C.migrateStages(fresh), fresh);
});

test('研磨刻度換算', () => {
  const c40 = { micronsPerStep: 30, zeroMicrons: 0, precision: 1 };
  const jx = { micronsPerStep: 12.5, zeroMicrons: 0, precision: 1 };
  const half = { micronsPerStep: 100, zeroMicrons: 50, precision: 0.5 };
  assert.equal(C.grinderMicrons(c40, 24), 720);
  assert.equal(C.convertGrind(c40, 24, jx), 58);
  assert.equal(C.grinderSetting(half, 720), 6.5);
  assert.equal(C.grinderMicrons({ micronsPerStep: null }, 10), null);
  assert.equal(C.convertGrind(c40, 24, {}), null);
});

test('同杯校正零點', () => {
  const c40 = { micronsPerStep: 30, zeroMicrons: 0 };
  const other = { micronsPerStep: 40, zeroMicrons: 0, precision: 0.1 };
  const zero = C.calibrateZero(c40, 24, other, 15); // 720 = z + 40*15
  assert.equal(zero, 120);
  assert.equal(C.convertGrind(c40, 24, { ...other, zeroMicrons: zero }), 15);
});

test('粒徑對應沖煮法', () => {
  const labels = C.methodsForMicrons(250).map((r) => r.key);
  assert.deepEqual(labels, ['espresso']);
  assert.ok(C.methodsForMicrons(700).some((r) => r.key === 'pourover'));
  const table = C.grinderRangeTable({ micronsPerStep: 30, zeroMicrons: 0, precision: 1 });
  const pour = table.find((r) => r.key === 'pourover');
  assert.equal(pour.from, 13);
  assert.equal(pour.to, 30);
});

test('養豆天數', () => {
  assert.equal(C.restDays('2026-10-01', '2026-10-08T08:30'), 7);
  assert.equal(C.restDays('', '2026-10-08'), null);
});
