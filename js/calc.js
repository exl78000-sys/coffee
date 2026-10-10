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

  /** 段落的結束秒數（每段的秒數都是「這段結束」的時間點） */
  function stageEnd(stage) {
    return stage ? parseTime(stage.end) : null;
  }

  /**
   * 計時器用：回傳目前所在段落索引 —— 第一個「結束時間還沒到」的段落。
   * 全部結束時回傳 stages.length。
   */
  function stageIndexAt(stages, elapsedSec) {
    const list = stages || [];
    for (let i = 0; i < list.length; i++) {
      const end = stageEnd(list[i]);
      if (end === null || elapsedSec < end) return i;
    }
    return list.length;
  }

  /**
   * 舊格式（每段記開始時間 start）轉成新格式（每段記結束秒數 end）：
   * 每段結束 = 下一段開始；最後一段用總時間，沒有就開始 + 30 秒。
   */
  function migrateStages(stages, totalTime) {
    const list = stages || [];
    if (!list.some((s) => s && s.start !== undefined && s.end === undefined)) return list;
    const total = parseTime(totalTime);
    return list.map((s, i) => {
      const out = Object.assign({}, s);
      const start = parseTime(s.start);
      const next = list[i + 1] ? parseTime(list[i + 1].start) : null;
      if (out.end === undefined) {
        out.end = next !== null ? next : total !== null && start !== null && total > start ? total : start !== null ? start + 30 : null;
      }
      delete out.start;
      return out;
    });
  }

  const POUR_TEMPLATES = {
    three: {
      label: '三段式',
      build(dose, water) {
        const bloom = Math.round(dose * 2);
        const second = Math.round(water * 0.6) - bloom;
        return [
          { label: '悶蒸', end: 40, amount: bloom, technique: '中心往外繞圈，確保粉層全濕' },
          { label: '第二段', end: 80, amount: second, technique: '中速繞圈' },
          { label: '第三段', end: 120, amount: water - bloom - second, technique: '中心小圈注水' },
        ];
      },
    },
    single: {
      label: '一刀流',
      build(dose, water) {
        const bloom = Math.round(dose * 2);
        return [
          { label: '悶蒸', end: 30, amount: bloom, technique: '繞圈注水' },
          { label: '一次注完', end: 120, amount: water - bloom, technique: '細水柱中心注水' },
        ];
      },
    },
    immersion: {
      label: '浸泡',
      build(dose, water) {
        return [
          { label: '注水浸泡', end: 120, amount: water, technique: '一次注入，輕攪拌' },
          { label: '濾出', end: 180, amount: 0, technique: '打開閥門 / 下壓' },
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

  /*
   * 大師／網路公開配方。數字取自原始來源或其整理（見 source），
   * 每段的 end 是該段結束（下一段開始）的秒數，計時從第一次注水開始。
   */
  const MASTER_RECIPES = [
    {
      key: 'hoffmann-v60',
      name: 'James Hoffmann 終極 V60',
      method: 'pourover', dose: 30, water: 500, temp: 97, totalTime: '3:30',
      grind: '中細', dripper: 'Hario V60 02',
      note: '大份量（2 杯）配方；淺焙可以用更燙的水。',
      source: { label: 'Hario USA', url: 'https://www.hario-usa.com/blogs/recipes-and-more-from-friends/james-hoffmann-uitimate-v60-technique' },
      stages: [
        { label: '悶蒸', amount: 60, end: 45, technique: '注入 2 倍粉量的水，搖晃濾杯讓粉全部濕透' },
        { label: '第一次主注水', amount: 240, end: 75, technique: '30 秒內注到 300g（總水量 60%）' },
        { label: '第二次主注水', amount: 200, end: 105, technique: '30 秒內注到 500g，輕攪一下再搖晃整平粉床' },
        { label: '滴濾', amount: 0, end: 210, technique: '等待滴濾，目標 3:30 前滴完' },
      ],
    },
    {
      key: 'hoffmann-1cup',
      name: 'James Hoffmann 單杯 V60',
      method: 'pourover', dose: 15, water: 250, temp: 96, totalTime: '3:00',
      grind: '中細', dripper: 'Hario V60 01/02',
      note: '每次注 50g，注 10 秒停 10 秒；淺焙可用 100°C，深焙降到 90°C 左右。',
      source: { label: 'Hario USA', url: 'https://www.hario-usa.com/blogs/recipes-and-more-from-friends/james-hoffmann-1-cup-v60-technique' },
      stages: [
        { label: '悶蒸', amount: 50, end: 45, technique: '慢慢注入 50g，0:10–0:15 輕搖濾杯，靜置到 0:45' },
        { label: '第 2 注', amount: 50, end: 70, technique: '1:00 前注到 100g，停到 1:10' },
        { label: '第 3 注', amount: 50, end: 90, technique: '1:20 前注到 150g，停到 1:30' },
        { label: '第 4 注', amount: 50, end: 110, technique: '1:40 前注到 200g，停到 1:50' },
        { label: '第 5 注', amount: 50, end: 125, technique: '2:00 前注到 250g，輕搖濾杯整平' },
        { label: '滴濾', amount: 0, end: 180, technique: '等待滴濾，約 3:00 滴完' },
      ],
    },
    {
      key: 'kasuya-46',
      name: '粕谷哲 4:6 法',
      method: 'pourover', dose: 20, water: 300, temp: 92, totalTime: '3:30',
      grind: '粗', dripper: 'Hario V60 02',
      note: '前 40% 調酸甜：第一注少偏甜、多偏酸；後 60% 調濃淡：分越多次越濃。',
      source: { label: 'Hario Europe', url: 'https://www.hario-europe.com/blogs/hario-community/v60-ambassadors-tetsu-kasuya' },
      stages: [
        { label: '第 1 注', amount: 50, end: 45, technique: '前 40%：這注少偏甜、多偏酸' },
        { label: '第 2 注', amount: 70, end: 90, technique: '補滿前 40%（120g）' },
        { label: '第 3 注', amount: 60, end: 135, technique: '後 60% 分三次，調整濃度' },
        { label: '第 4 注', amount: 60, end: 180 },
        { label: '第 5 注', amount: 60, end: 210, technique: '3:30 移開濾杯' },
      ],
    },
    {
      key: 'origin-v60',
      name: 'Origin Coffee V60',
      method: 'pourover', dose: 15, water: 250, temp: 95, totalTime: '3:15',
      grind: '中', dripper: 'Hario V60 02',
      note: '水溫 93–96°C；滴太慢就磨粗、太快就磨細。',
      source: { label: 'Origin Coffee', url: 'https://www.origincoffee.co.uk/blogs/journal/brewing-at-home-v60' },
      stages: [
        { label: '悶蒸', amount: 45, end: 30, technique: '繞圈注水，0:30 前注完' },
        { label: '第 2 注', amount: 55, end: 60, technique: '注到 100g' },
        { label: '第 3 注', amount: 50, end: 90, technique: '注到 150g' },
        { label: '第 4 注', amount: 100, end: 195, technique: '注到 250g 後等待滴濾，約 3:00–3:30 完成' },
      ],
    },
    {
      key: 'hoffmann-aeropress',
      name: 'James Hoffmann 愛樂壓',
      method: 'immersion', dose: 11, water: 200, temp: 99, totalTime: '3:00',
      grind: '中細', dripper: '愛樂壓（正放、濾紙）',
      note: '不用預熱或洗濾紙；用搖晃代替攪拌，最後輕壓。',
      source: { label: 'AeroPrecipe 整理', url: 'https://aeroprecipe.com/recipes/james-hoffmann-aeropress-recipe' },
      stages: [
        { label: '注水', amount: 200, end: 120, technique: '一次注入 200g，立刻插上活塞防止滴漏，靜置' },
        { label: '搖晃', amount: 0, end: 150, technique: '輕輕搖晃，再靜置 30 秒' },
        { label: '下壓', amount: 0, end: 180, technique: '輕輕壓到底' },
      ],
    },
    {
      key: 'hoffmann-frenchpress',
      name: 'James Hoffmann 法壓壺',
      method: 'immersion', dose: 30, water: 500, temp: 93, totalTime: '9:30',
      grind: '粗', dripper: '法壓壺',
      note: '等越久越乾淨；倒出時活塞只當濾網，不要壓到底。',
      source: { label: 'LAMOSE 整理', url: 'https://lamose.com/blogs/recipes/james-hoffmanns-french-press-method-the-better-way' },
      stages: [
        { label: '注水浸泡', amount: 500, end: 240, technique: '注入全部熱水，靜置 4 分鐘' },
        { label: '破渣撈沫', amount: 0, end: 270, technique: '攪開表面粉層，撈掉浮沫' },
        { label: '靜置沉澱', amount: 0, end: 540, technique: '再等 5 分鐘以上讓細粉沉底' },
        { label: '倒出', amount: 0, end: 570, technique: '活塞只壓到液面，慢慢倒出' },
      ],
    },
  ];

  /**
   * 依使用者的粉量套用大師配方：保留原配方的水粉比與時間點，水量等比例換算。
   * 沒填粉量就用原配方份量。
   */
  function applyMasterRecipe(key, dose) {
    const r = MASTER_RECIPES.find((x) => x.key === key);
    if (!r) return null;
    dose = num(dose) || r.dose;
    const water = Math.round(dose * r.water / r.dose);
    return {
      method: r.method,
      dose,
      ratio: round(r.water / r.dose, 0.1),
      water,
      temp: r.temp,
      dripper: r.dripper,
      totalTime: r.totalTime,
      recipeKey: r.key,
      recipeName: r.name,
      stages: scaleStages(r.stages, water),
    };
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
    stagesTotal, cumulative, scaleStages, stageEnd, stageIndexAt, migrateStages, POUR_TEMPLATES, buildTemplate,
    MASTER_RECIPES, applyMasterRecipe,
    METHOD_RANGES, GRINDER_PRESETS, canConvert, grinderMicrons, grinderSetting,
    convertGrind, calibrateZero, methodsForMicrons, grinderRangeTable,
    restDays,
  };
});
