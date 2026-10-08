/*
 * 純計算函式：水粉比、分段縮放、研磨刻度換算、沖煮範本。
 * 同時支援瀏覽器（掛在 window.Calc）與 Node（module.exports，供測試使用）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 通用 ----------

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  function round(n, step) {
    if (n === null || n === undefined || !Number.isFinite(n)) return null;
    const s = step || 1;
    const r = Math.round(n / s) * s;
    // 避免 0.1 + 0.2 之類的浮點尾數
    const decimals = (String(s).split('.')[1] || '').length;
    return Number(r.toFixed(decimals));
  }

  /** "2:30" / "2'30" / "150" → 150 秒；無法解析回傳 null */
  function parseTime(text) {
    if (text === null || text === undefined) return null;
    if (typeof text === 'number') return Number.isFinite(text) ? text : null;
    const t = String(text).trim();
    if (!t) return null;
    const m = t.match(/^(\d+)\s*[:：'′分]\s*(\d{1,2})\s*(?:秒|"|″)?$/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const s = t.match(/^(\d+(?:\.\d+)?)\s*(?:s|秒)?$/i);
    if (s) return Math.round(parseFloat(s[1]));
    return null;
  }

  /** 150 → "2:30" */
  function formatTime(sec) {
    if (sec === null || sec === undefined || !Number.isFinite(sec)) return '';
    const neg = sec < 0;
    const total = Math.abs(Math.round(sec));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return (neg ? '-' : '') + m + ':' + String(s).padStart(2, '0');
  }

  // ---------- 水粉比 ----------

  function waterFromDose(dose, ratio) {
    dose = num(dose); ratio = num(ratio);
    if (dose === null || ratio === null) return null;
    return round(dose * ratio, 1);
  }

  function doseFromWater(water, ratio) {
    water = num(water); ratio = num(ratio);
    if (water === null || !ratio) return null;
    return round(water / ratio, 0.1);
  }

  function ratioOf(dose, water) {
    dose = num(dose); water = num(water);
    if (!dose || water === null) return null;
    return round(water / dose, 0.1);
  }

  /** 濾泡式預估萃取液重量：咖啡粉約吸附 2 倍重量的水 */
  function estimatedBeverage(water, dose, absorption) {
    water = num(water); dose = num(dose);
    if (water === null || dose === null) return null;
    const a = absorption === undefined ? 2 : absorption;
    return Math.max(0, round(water - dose * a, 1));
  }

  // ---------- 分段注水 ----------

  function stagesTotal(stages) {
    return (stages || []).reduce((sum, s) => sum + (num(s.amount) || 0), 0);
  }

  /** 每一段結束時的累計水量 */
  function cumulative(stages) {
    let acc = 0;
    return (stages || []).map((s) => (acc += num(s.amount) || 0));
  }

  /**
   * 依新的總水量等比例縮放各段水量（取整數克），
   * 並把四捨五入的誤差補到最後一段有水量的段落，確保總和正好等於 newTotal。
   */
  function scaleStages(stages, newTotal) {
    newTotal = num(newTotal);
    const list = (stages || []).map((s) => Object.assign({}, s));
    const oldTotal = stagesTotal(list);
    if (!oldTotal || newTotal === null) return list;
    const k = newTotal / oldTotal;
    list.forEach((s) => {
      const a = num(s.amount);
      if (a !== null) s.amount = Math.round(a * k);
    });
    const diff = Math.round(newTotal) - stagesTotal(list);
    if (diff !== 0) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (num(list[i].amount)) { list[i].amount += diff; break; }
      }
    }
    return list;
  }

  /** 計時器用：回傳目前所在段落索引（-1 表示尚未開始） */
  function stageIndexAt(stages, elapsedSec) {
    let idx = -1;
    (stages || []).forEach((s, i) => {
      const start = parseTime(s.start);
      if (start !== null && elapsedSec >= start) idx = i;
    });
    return idx;
  }

  const POUR_TEMPLATES = {
    three: {
      label: '三段式',
      build(dose, water) {
        const bloom = Math.round(dose * 2);
        const second = Math.round(water * 0.6) - bloom;
        return [
          { label: '悶蒸', start: '0:00', amount: bloom, technique: '中心往外繞圈，確保粉層全濕' },
          { label: '第二段', start: '0:40', amount: second, technique: '中速繞圈' },
          { label: '第三段', start: '1:20', amount: water - bloom - second, technique: '中心小圈注水' },
        ];
      },
    },
    four6: {
      label: '4:6 法',
      build(dose, water) {
        const p = Math.round(water * 0.2);
        return [
          { label: '第 1 注', start: '0:00', amount: p, technique: '前 40% 調整酸甜' },
          { label: '第 2 注', start: '0:45', amount: p, technique: '' },
          { label: '第 3 注', start: '1:30', amount: p, technique: '後 60% 調整濃度' },
          { label: '第 4 注', start: '2:10', amount: p, technique: '' },
          { label: '第 5 注', start: '2:40', amount: water - p * 4, technique: '' },
        ];
      },
    },
    single: {
      label: '一刀流',
      build(dose, water) {
        const bloom = Math.round(dose * 2);
        return [
          { label: '悶蒸', start: '0:00', amount: bloom, technique: '繞圈注水' },
          { label: '一次注完', start: '0:30', amount: water - bloom, technique: '細水柱中心注水' },
        ];
      },
    },
    immersion: {
      label: '浸泡',
      build(dose, water) {
        return [
          { label: '注水', start: '0:00', amount: water, technique: '一次注入，輕攪拌' },
          { label: '濾出', start: '2:00', amount: 0, technique: '打開閥門 / 下壓' },
        ];
      },
    },
  };

  function buildTemplate(key, dose, water) {
    const t = POUR_TEMPLATES[key];
    dose = num(dose); water = num(water);
    if (!t || !dose || !water) return [];
    return t.build(dose, Math.round(water));
  }

  // ---------- 研磨刻度 ----------

  /*
   * 以線性模型近似：粒徑(µm) ≈ 零點偏移 + 每格微米 × 格數。
   * 各沖煮法的粒徑範圍為常見參考值，不同豆子、烘焙度、濾杯都會影響，
   * 只能當起點，實際仍以口感微調。
   */
  const METHOD_RANGES = [
    { key: 'espresso', label: '義式', min: 180, max: 380 },
    { key: 'moka', label: '摩卡壺', min: 360, max: 660 },
    { key: 'aeropress', label: '愛樂壓', min: 320, max: 960 },
    { key: 'pourover', label: '手沖', min: 400, max: 900 },
    { key: 'immersion', label: '法壓 / 浸泡', min: 690, max: 1300 },
    { key: 'coldbrew', label: '冷萃', min: 800, max: 1400 },
  ];

  /* 常見手搖磨豆機的每格微米數（廠商或社群量測的近似值，以「總格數」計算，零點視為 0） */
  const GRINDER_PRESETS = [
    { key: 'c40', name: 'Comandante C40 MK4', micronsPerStep: 30, zeroMicrons: 0, precision: 1 },
    { key: 'jxpro', name: '1Zpresso JX-Pro', micronsPerStep: 12.5, zeroMicrons: 0, precision: 1 },
    { key: 'kultra', name: '1Zpresso K-Ultra', micronsPerStep: 20, zeroMicrons: 0, precision: 1 },
    { key: 'kmax', name: '1Zpresso K-Max', micronsPerStep: 22, zeroMicrons: 0, precision: 1 },
    { key: 'k6', name: 'Kingrinder K6', micronsPerStep: 16, zeroMicrons: 0, precision: 1 },
  ];

  function canConvert(grinder) {
    return !!(grinder && num(grinder.micronsPerStep));
  }

  function grinderMicrons(grinder, setting) {
    setting = num(setting);
    if (!canConvert(grinder) || setting === null) return null;
    return Math.round((num(grinder.zeroMicrons) || 0) + num(grinder.micronsPerStep) * setting);
  }

  function grinderSetting(grinder, microns) {
    microns = num(microns);
    if (!canConvert(grinder) || microns === null) return null;
    const raw = (microns - (num(grinder.zeroMicrons) || 0)) / num(grinder.micronsPerStep);
    return round(Math.max(0, raw), num(grinder.precision) || 1);
  }

  function convertGrind(fromGrinder, setting, toGrinder) {
    const m = grinderMicrons(fromGrinder, setting);
    return m === null ? null : grinderSetting(toGrinder, m);
  }

  /**
   * 「A 磨的 X 格 = B 磨的 Y 格」校正：回傳 B 磨新的零點偏移（µm），
   * 讓兩台在這個點上換算一致。
   */
  function calibrateZero(fromGrinder, fromSetting, toGrinder, toSetting) {
    const m = grinderMicrons(fromGrinder, fromSetting);
    toSetting = num(toSetting);
    if (m === null || toSetting === null || !canConvert(toGrinder)) return null;
    return Math.round(m - num(toGrinder.micronsPerStep) * toSetting);
  }

  function methodsForMicrons(microns) {
    microns = num(microns);
    if (microns === null) return [];
    return METHOD_RANGES.filter((r) => microns >= r.min && microns <= r.max);
  }

  /** 某台磨豆機在各沖煮法的建議格數範圍 */
  function grinderRangeTable(grinder) {
    if (!canConvert(grinder)) return [];
    return METHOD_RANGES.map((r) => ({
      key: r.key,
      label: r.label,
      from: grinderSetting(grinder, r.min),
      to: grinderSetting(grinder, r.max),
    }));
  }

  // ---------- 豆子 ----------

  /** 養豆天數（沖煮日 − 烘焙日） */
  function restDays(roastDate, brewDate) {
    if (!roastDate) return null;
    const r = new Date(String(roastDate).slice(0, 10) + 'T00:00:00');
    const b = brewDate ? new Date(String(brewDate).slice(0, 10) + 'T00:00:00') : new Date();
    if (isNaN(r) || isNaN(b)) return null;
    if (!brewDate) b.setHours(0, 0, 0, 0);
    return Math.round((b - r) / 86400000);
  }

  return {
    num, round, parseTime, formatTime,
    waterFromDose, doseFromWater, ratioOf, estimatedBeverage,
    stagesTotal, cumulative, scaleStages, stageIndexAt, POUR_TEMPLATES, buildTemplate,
    METHOD_RANGES, GRINDER_PRESETS, canConvert, grinderMicrons, grinderSetting,
    convertGrind, calibrateZero, methodsForMicrons, grinderRangeTable,
    restDays,
  };
});
