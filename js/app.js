/*
 * 畫面與互動。以 hash 路由切換頁面：
 *   #/brews  #/brew/new  #/brew/:id  #/brew/:id/edit
 *   #/beans  #/bean/new  #/bean/:id  #/bean/:id/edit
 *   #/timer  #/timer/:id  #/timer/free
 *   #/tools?t=ratio|scale|grind
 *   #/settings  #/grinder/new  #/grinder/:id/edit
 */
(function () {
  'use strict';

  const C = window.Calc;
  const S = window.Store;
  const view = document.getElementById('view');

  // ---------- 設定 ----------

  const METHODS = {
    pourover: { label: '手沖', out: 'water', outLabel: '水量', ratio: 16, dose: 15, temp: 92, stages: true, template: 'three', range: 'pourover' },
    immersion: { label: '浸泡式', out: 'water', outLabel: '水量', ratio: 15, dose: 15, temp: 94, stages: true, template: 'immersion', range: 'immersion' },
    espresso: { label: '義式', out: 'yield', outLabel: '萃取量', ratio: 2, dose: 18, temp: 93, stages: false, range: 'espresso' },
    moka: { label: '摩卡壺', out: 'water', outLabel: '水量', ratio: 10, dose: 15, temp: null, stages: false, range: 'moka' },
  };
  const METHOD_KEYS = Object.keys(METHODS);

  // [欄位, 標籤, placeholder, 是否數字]
  const EXTRA = {
    pourover: [['dripper', '濾杯', 'V60 / Kalita / Origami'], ['filter', '濾紙', '錐形 / 波浪'], ['temp', '水溫 °C', '92', true]],
    immersion: [['dripper', '器具', '法壓 / 聰明濾杯 / 愛樂壓'], ['filter', '濾材', '濾紙 / 金屬濾網'], ['temp', '水溫 °C', '94', true]],
    espresso: [['machine', '咖啡機', ''], ['basket', '粉碗', '18g 精準粉碗'], ['temp', '水溫 °C', '93', true], ['preinfusion', '預浸泡 秒', '5', true], ['pressure', '壓力 bar', '9', true]],
    moka: [['dripper', '摩卡壺', 'Bialetti 3 杯份'], ['waterStart', '注入的水', '熱水 / 冷水'], ['heat', '火力', '中小火'], ['flowStart', '開始流出', '2:30']],
  };

  const RECIPE_FIELDS = ['method', 'grinderId', 'grindSetting', 'dose', 'ratio', 'water', 'yield', 'temp', 'dripper', 'filter',
    'machine', 'basket', 'preinfusion', 'pressure', 'waterStart', 'heat', 'flowStart', 'totalTime'];
  const NUM_FIELDS = new Set(['dose', 'ratio', 'water', 'yield', 'temp', 'preinfusion', 'pressure']);
  const TASTE = [['acidity', '酸'], ['sweetness', '甜'], ['bitterness', '苦'], ['body', '醇厚']];
  const TASTE_KEYS = new Set(TASTE.map((t) => t[0]));
  const ROASTS = ['極淺焙', '淺焙', '中淺焙', '中焙', '中深焙', '深焙'];
  const PROCESSES = ['水洗', '日曬', '蜜處理', '厭氧發酵', '濕剝', '二氧化碳浸漬'];
  const TECHNIQUES = ['繞圈', '中心注水', '螺旋往外', '細水柱', '大水柱沖擊', '攪拌', '搖晃濾杯', '靜置'];
  const RATIO_PRESETS = [['手沖 1:15', 15], ['手沖 1:16', 16], ['手沖 1:17', 17], ['義式 1:2', 2], ['摩卡壺 1:10', 10], ['冷萃 1:8', 8]];

  let cleanup = null; // 離開頁面時要執行的收尾（計時器）
  let pending = null; // 從計時器 / 工具帶到「新增記錄」的草稿

  // ---------- 小工具 ----------

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function nowLocal() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function dateOffset(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function fmtDate(s) {
    if (!s) return '';
    const sameYear = s.slice(0, 4) === String(new Date().getFullYear());
    return (sameYear ? '' : s.slice(0, 4) + '/') + s.slice(5, 7) + '/' + s.slice(8, 10) + (s.length > 10 ? ' ' + s.slice(11, 16) : '');
  }

  const byDateDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));

  function stars(n) {
    if (!n) return '<span class="muted">未評分</span>';
    return '<span class="stars">' + '★'.repeat(n) + '<span class="off">' + '★'.repeat(5 - n) + '</span></span>';
  }

  function mount(html) {
    view.innerHTML = html;
    return view.firstElementChild;
  }

  function header(title, opts) {
    opts = opts || {};
    return `<header class="top">
      ${opts.back ? `<a class="back" href="${opts.back}" aria-label="返回">‹</a>` : ''}
      <h1>${esc(title)}</h1>
      ${opts.action || ''}
    </header>`;
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2200);
  }

  function notFound() {
    mount(`<div class="page">${header('找不到', { back: '#/brews' })}<p class="empty">這筆資料不存在或已被刪除。</p></div>`);
  }

  function field(label, input, cls) {
    return `<label class="field ${cls || ''}"><span>${label}</span>${input}</label>`;
  }

  function numInput(f, value, extra) {
    return `<input type="number" step="any" inputmode="decimal" data-f="${f}" value="${esc(value)}" ${extra || ''}>`;
  }

  // ---------- 資料輔助 ----------

  function beanName(id) {
    const b = S.get('beans', id);
    return b ? b.name : '未指定豆子';
  }

  function unitOf(g) {
    return g && g.unit !== undefined && g.unit !== null ? g.unit : '格';
  }

  function grindText(b) {
    const g = S.get('grinders', b.grinderId);
    if (!g && !b.grindSetting) return '';
    return [g ? g.name : '', b.grindSetting ? b.grindSetting + ' ' + unitOf(g) : ''].filter(Boolean).join(' ').trim();
  }

  function summary(b) {
    const m = METHODS[b.method] || METHODS.pourover;
    const out = b[m.out];
    return [
      b.dose ? b.dose + 'g' : '',
      b.ratio ? '1:' + b.ratio : '',
      out ? (m.out === 'yield' ? '出 ' : '') + out + 'g' : '',
      grindText(b),
      b.totalTime || '',
    ].filter(Boolean).join(' · ');
  }

  function beanBrews(beanId) {
    return S.all('brews').filter((b) => b.beanId === beanId).sort(byDateDesc);
  }

  /** 明確標記的最佳配方優先，否則取評分最高（同分取最新） */
  function bestBrew(beanId, method, excludeId) {
    const list = beanBrews(beanId).filter((b) => (!method || b.method === method) && b.id !== excludeId);
    return list.find((b) => b.isBest) || list.filter((b) => b.rating).sort((a, b) => b.rating - a.rating)[0] || null;
  }

  function remaining(bean) {
    const w = C.num(bean.weight);
    if (w === null) return null;
    const used = beanBrews(bean.id).reduce((s, b) => s + (C.num(b.dose) || 0), 0);
    return Math.max(0, C.round(w - used, 0.1));
  }

  function methodTag(m) {
    return `<span class="tag m-${esc(m)}">${esc((METHODS[m] || METHODS.pourover).label)}</span>`;
  }

  function brewCard(b, opts) {
    opts = opts || {};
    return `<a class="card brew-card" href="#/brew/${b.id}">
      <div class="row">${methodTag(b.method)}<strong class="grow">${esc(opts.hideBean ? fmtDate(b.date) : beanName(b.beanId))}</strong>${b.isBest ? '<span class="best">★ 最佳</span>' : ''}</div>
      <div class="meta">${esc(summary(b)) || '<span class="muted">沒有參數</span>'}</div>
      <div class="row">${stars(b.rating)}<span class="muted small">${opts.hideBean ? '' : esc(fmtDate(b.date))}</span></div>
    </a>`;
  }

  function stagesTable(stages) {
    if (!stages || !stages.length) return '';
    const cum = C.cumulative(stages);
    return `<table class="table stages-table">
      <thead><tr><th>時間</th><th>段落 / 手法</th><th class="r">注水</th><th class="r">累計</th></tr></thead>
      <tbody>${stages.map((s, i) => `<tr>
        <td class="mono">${esc(s.start)}</td>
        <td>${esc(s.label)}${s.technique ? `<div class="muted small">${esc(s.technique)}</div>` : ''}</td>
        <td class="r mono">${s.amount ? esc(s.amount) + 'g' : '—'}</td>
        <td class="r mono">${cum[i]}g</td></tr>`).join('')}</tbody></table>`;
  }

  // ---------- 路由 ----------

  function route() {
    if (cleanup) { cleanup(); cleanup = null; }
    const h = location.hash.slice(1) || '/brews';
    const [path, qs] = h.split('?');
    const [a, b, c] = path.split('/').filter(Boolean);
    const q = new URLSearchParams(qs || '');
    let tab = a;

    if (a === 'brews') renderBrewList(q);
    else if (a === 'brew') {
      tab = 'brews';
      if (b === 'new') renderBrewForm(null, q);
      else if (c === 'edit') renderBrewForm(b, q);
      else renderBrewDetail(b);
    } else if (a === 'beans') renderBeanList(q);
    else if (a === 'bean') {
      tab = 'beans';
      if (b === 'new') renderBeanForm(null);
      else if (c === 'edit') renderBeanForm(b);
      else renderBeanDetail(b);
    } else if (a === 'timer') renderTimer(b);
    else if (a === 'tools') renderTools(q);
    else if (a === 'settings') renderSettings();
    else if (a === 'grinder') { tab = 'settings'; renderGrinderForm(b === 'new' ? null : b); }
    else { location.replace('#/brews'); return; }

    $$('.tabbar a').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
    window.scrollTo(0, 0);
  }

  // ---------- 沖煮記錄列表 ----------

  function renderBrewList(q) {
    const method = q.get('m') || '';
    const beanId = q.get('bean') || '';
    const link = (m, bn) => '#/brews?' + new URLSearchParams(Object.entries({ m, bean: bn }).filter((e) => e[1])).toString();
    let brews = S.all('brews').slice().sort(byDateDesc);
    if (method) brews = brews.filter((b) => b.method === method);
    if (beanId) brews = brews.filter((b) => b.beanId === beanId);
    const beans = S.all('beans').slice().sort((x, y) => x.name.localeCompare(y.name, 'zh-Hant'));

    const page = mount(`<div class="page">
      ${header('沖煮記錄', { action: `<a class="btn primary small" href="#/brew/new${method ? '?m=' + method : ''}">＋ 新增</a>` })}
      <div class="chips scroll">
        <a class="chip ${!method ? 'on' : ''}" href="${link('', beanId)}">全部</a>
        ${METHOD_KEYS.map((k) => `<a class="chip ${method === k ? 'on' : ''}" href="${link(k, beanId)}">${METHODS[k].label}</a>`).join('')}
      </div>
      ${beans.length ? `<select class="filter" id="bean-filter">
        <option value="">所有豆子</option>
        ${beans.map((b) => `<option value="${b.id}" ${b.id === beanId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
      </select>` : ''}
      <div class="list">${brews.length ? brews.map((b) => brewCard(b)).join('') : emptyBrews()}</div>
    </div>`);

    const sel = $('#bean-filter', page);
    if (sel) sel.addEventListener('change', () => { location.hash = link(method, sel.value); });
  }

  function emptyBrews() {
    const fresh = !S.all('brews').length && !S.all('beans').length;
    return `<div class="empty">
      <p>${fresh ? '還沒有任何記錄。' : '沒有符合條件的記錄。'}</p>
      ${fresh ? `<p>建議順序：先到「設定」加入你的磨豆機 → 「豆子」新增一支豆子 → 回來新增第一筆沖煮。</p>
        <p><a class="btn" href="#/settings">前往設定</a> <a class="btn primary" href="#/brew/new">新增記錄</a></p>` : ''}
    </div>`;
  }

  // ---------- 沖煮記錄詳細 ----------

  function renderBrewDetail(id) {
    const b = S.get('brews', id);
    if (!b) return notFound();
    const m = METHODS[b.method] || METHODS.pourover;
    const bean = S.get('beans', b.beanId);
    const g = S.get('grinders', b.grinderId);
    const mic = C.grinderMicrons(g, b.grindSetting);
    const rd = bean ? C.restDays(bean.roastDate, b.date) : null;

    const stats = [
      ['粉量', b.dose ? b.dose + ' g' : ''],
      ['水粉比', b.ratio ? '1:' + b.ratio : ''],
      [m.outLabel, b[m.out] ? b[m.out] + ' g' : ''],
      ['總時間', b.totalTime],
      ['研磨', grindText(b) + (mic !== null ? `（≈${mic}µm）` : '')],
    ].concat((EXTRA[b.method] || []).map(([f, label]) => [label, b[f]]))
      .concat([['養豆天數', rd !== null ? rd + ' 天' : '']])
      .filter((s) => s[1] !== '' && s[1] !== null && s[1] !== undefined);

    const tasteBars = TASTE.filter(([k]) => b[k]).map(([k, l]) =>
      `<div class="bar"><span>${l}</span><div class="track"><div style="width:${b[k] * 20}%"></div></div><b>${b[k]}</b></div>`).join('');

    const page = mount(`<div class="page">
      ${header(bean ? bean.name : '未指定豆子', { back: '#/brews', action: `<a class="btn small" href="#/brew/${id}/edit">編輯</a>` })}
      <div class="row sub">${methodTag(b.method)}<span class="muted">${esc(fmtDate(b.date))}</span>${b.isBest ? '<span class="best">★ 最佳配方</span>' : ''}</div>
      <section class="card"><div class="stats">${stats.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div></section>
      ${b.stages && b.stages.length ? `<section class="card"><h2>分段注水</h2>${stagesTable(b.stages)}</section>` : ''}
      <section class="card"><h2>風味</h2>
        <div class="big-stars">${stars(b.rating)}</div>
        ${tasteBars ? `<div class="bars">${tasteBars}</div>` : ''}
        ${b.flavorNotes ? `<p><b>風味：</b>${esc(b.flavorNotes)}</p>` : ''}
        ${b.notes ? `<p><b>心得：</b>${esc(b.notes)}</p>` : ''}
        ${b.nextTime ? `<p class="note"><b>下次調整：</b>${esc(b.nextTime)}</p>` : ''}
      </section>
      <div class="actions">
        <a class="btn primary" href="#/timer/${id}">⏱ 跟著計時沖</a>
        <a class="btn" href="#/brew/new?from=${id}">再沖一次</a>
        <button class="btn" data-act="best">${b.isBest ? '取消最佳配方' : '★ 設為最佳配方'}</button>
        ${bean ? `<a class="btn ghost" href="#/bean/${bean.id}">看這支豆子</a>` : ''}
        <button class="btn danger ghost" data-act="del">刪除</button>
      </div>
    </div>`);

    page.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'best') {
        S.toggleBest(id);
        toast(S.get('brews', id).isBest ? `已設為這支豆子的${m.label}最佳配方` : '已取消最佳配方');
        renderBrewDetail(id);
      } else if (act.dataset.act === 'del' && confirm('確定刪除這筆記錄？')) {
        S.remove('brews', id);
        location.hash = '#/brews';
      }
    });
  }

  // ---------- 新增 / 編輯沖煮記錄 ----------

  function methodDefaults(method, dose) {
    const m = METHODS[method];
    const d = { method, dose: dose || m.dose, ratio: m.ratio };
    d[m.out] = C.waterFromDose(d.dose, d.ratio);
    if (m.temp) d.temp = m.temp;
    d.stages = m.stages ? C.buildTemplate(m.template, d.dose, d.water) : [];
    return d;
  }

  function newDraft(q) {
    const brews = S.all('brews').slice().sort(byDateDesc);
    const last = brews[0];
    const from = q.get('from') && S.get('brews', q.get('from'));
    let d;
    if (q.get('pending') && pending) {
      d = Object.assign(methodDefaults(pending.method || 'pourover'), pending);
      pending = null;
    } else if (from) {
      d = { beanId: from.beanId, stages: clone(from.stages || []) };
      RECIPE_FIELDS.forEach((f) => { if (from[f] !== undefined) d[f] = from[f]; });
    } else {
      const method = METHODS[q.get('m')] ? q.get('m') : (last && last.method) || 'pourover';
      d = methodDefaults(method);
      d.beanId = q.get('bean') || '';
      d.grinderId = (last && last.grinderId) || (S.all('grinders')[0] || {}).id || '';
      // 同一支豆子、同沖煮法有最佳配方時直接帶入
      const best = d.beanId && bestBrew(d.beanId, method);
      if (best) {
        RECIPE_FIELDS.forEach((f) => { if (best[f] !== undefined) d[f] = best[f]; });
        d.stages = clone(best.stages || []);
      }
    }
    if (q.get('time')) d.totalTime = C.formatTime(+q.get('time'));
    d.date = nowLocal();
    return d;
  }

  function renderBrewForm(id, q) {
    const editing = id ? S.get('brews', id) : null;
    if (id && !editing) return notFound();
    const d = editing ? clone(editing) : newDraft(q);
    d.stages = d.stages || [];
    let autoScale = true;
    let grindNote = '';
    let page;

    function draw() {
      page = mount(formHtml());
      bind();
      if (METHODS[d.method].stages) renderStages();
      updateBeanHint();
      updateGrindHint();
      updateRatioHint();
    }

    function formHtml() {
      const m = METHODS[d.method];
      const beans = S.all('beans').filter((b) => !b.archived || b.id === d.beanId)
        .sort((x, y) => x.name.localeCompare(y.name, 'zh-Hant'));
      const grinders = S.all('grinders');
      const extras = (EXTRA[d.method] || []).map(([f, label, ph, isNum]) =>
        field(label, isNum ? numInput(f, d[f], `placeholder="${ph}"`) : `<input data-f="${f}" value="${esc(d[f])}" placeholder="${esc(ph)}">`)).join('');

      return `<div class="page">
        ${header(editing ? '編輯記錄' : '新增記錄', { back: editing ? '#/brew/' + editing.id : '#/brews' })}
        <form id="brew-form" autocomplete="off">
          <section class="card">
            <div class="seg">${METHOD_KEYS.map((k) => `<label><input type="radio" name="method" value="${k}" data-f="method" ${d.method === k ? 'checked' : ''}><span>${METHODS[k].label}</span></label>`).join('')}</div>
            <div>
              ${field('日期時間', `<input type="datetime-local" data-f="date" value="${esc(d.date)}">`)}
              ${field('豆子', `<select data-f="beanId"><option value="">（未指定）</option>${beans.map((b) => `<option value="${b.id}" ${b.id === d.beanId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>`)}
            </div>
            <div id="bean-hint" class="hint"></div>
          </section>

          <section class="card"><h2>研磨</h2>
            <div class="grid2">
              ${field('磨豆機', `<select data-f="grinderId"><option value="">（未指定）</option>${grinders.map((g) => `<option value="${g.id}" ${g.id === d.grinderId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>`)}
              ${field('刻度', `<input data-f="grindSetting" inputmode="decimal" value="${esc(d.grindSetting)}" placeholder="例：24">`)}
            </div>
            <div id="grind-hint" class="hint"></div>
          </section>

          <section class="card"><h2>比例與參數</h2>
            <div class="grid3">
              ${field('粉量 g', numInput('dose', d.dose))}
              ${field('水粉比 1:', numInput('ratio', d.ratio))}
              ${field(m.outLabel + ' g', numInput(m.out, d[m.out]))}
            </div>
            <div id="ratio-hint" class="hint"></div>
            <div class="grid2">
              ${extras}
              ${field(d.method === 'espresso' ? '萃取時間' : '總時間', `<input data-f="totalTime" value="${esc(d.totalTime)}" placeholder="${d.method === 'espresso' ? '0:28' : '2:45'}" inputmode="numeric">`)}
            </div>
          </section>

          ${m.stages ? `<section class="card">
            <div class="card-head"><h2>分段注水</h2>
              <label class="check"><input type="checkbox" id="auto-scale" ${autoScale ? 'checked' : ''}> 隨水量等比例調整</label></div>
            <div class="chips"><span class="muted small">套用範本：</span>${Object.entries(C.POUR_TEMPLATES).map(([k, t]) => `<button type="button" class="chip" data-act="tpl" data-k="${k}">${t.label}</button>`).join('')}</div>
            <div id="stages"></div>
            <button type="button" class="btn ghost block" data-act="add-stage">＋ 新增段落</button>
            <div id="stage-sum" class="hint"></div>
          </section>` : ''}

          <section class="card"><h2>風味</h2>
            <div class="star-input">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star ${n <= (d.rating || 0) ? 'on' : ''}" data-act="rate" data-n="${n}" aria-label="${n} 星">★</button>`).join('')}</div>
            ${TASTE.map(([k, l]) => `<label class="slider"><span>${l}</span><input type="range" min="0" max="5" step="1" data-f="${k}" value="${d[k] || 0}"><output id="o-${k}">${d[k] || '—'}</output></label>`).join('')}
            ${field('風味描述', `<input data-f="flavorNotes" value="${esc(d.flavorNotes)}" placeholder="柑橘、花香、焦糖…">`)}
            ${field('心得', `<textarea data-f="notes" rows="2" placeholder="這杯喝起來如何？">${esc(d.notes)}</textarea>`)}
            ${field('下次調整', `<textarea data-f="nextTime" rows="2" placeholder="例：磨細 2 格、水溫降到 90°C">${esc(d.nextTime)}</textarea>`)}
          </section>

          <div class="form-actions">
            <a class="btn ghost" href="${editing ? '#/brew/' + editing.id : '#/brews'}">取消</a>
            <button class="btn primary" type="submit">儲存</button>
          </div>
        </form>
        <datalist id="tech-list">${TECHNIQUES.map((t) => `<option value="${t}">`).join('')}</datalist>
      </div>`;
    }

    function stageRow(s, i) {
      return `<div class="stage" data-i="${i}">
        <div class="stage-head">
          <span class="stage-no">${i + 1}</span>
          <input data-sf="label" value="${esc(s.label)}" placeholder="段落名稱">
          <button type="button" class="icon-btn" data-act="del-stage" aria-label="刪除段落">✕</button>
        </div>
        <div class="grid3">
          ${field('開始', `<input data-sf="start" value="${esc(s.start)}" placeholder="0:00" inputmode="numeric">`)}
          ${field('注水 g', `<input type="number" step="any" inputmode="decimal" data-sf="amount" value="${esc(s.amount)}">`)}
          <div class="field"><span>累計</span><output class="cum">—</output></div>
        </div>
        <input data-sf="technique" list="tech-list" value="${esc(s.technique)}" placeholder="手法：繞圈 / 中心注水 / 攪拌…">
      </div>`;
    }

    function renderStages() {
      $('#stages', page).innerHTML = d.stages.map(stageRow).join('') ||
        '<p class="muted small">還沒有分段，可以套用範本或手動新增。</p>';
      updateStageSum();
    }

    function updateStageSum() {
      const el = $('#stage-sum', page);
      if (!el) return;
      const cum = C.cumulative(d.stages);
      $$('.stage', page).forEach((row, i) => { $('.cum', row).textContent = cum[i] + ' g'; });
      const sum = C.stagesTotal(d.stages);
      const water = C.num(d.water);
      const off = water !== null && d.stages.length && Math.abs(sum - water) > 0.5;
      el.className = 'hint' + (off ? ' warn' : '');
      el.innerHTML = d.stages.length ? `分段合計 <b>${sum}</b> g${water !== null ? ` / 總水量 ${water} g` : ''}${off ? '（不一致）' : ''}` : '';
    }

    function setVal(f, v) {
      const el = page.querySelector(`[data-f="${f}"]`);
      if (el && el !== document.activeElement) el.value = v === null || v === undefined ? '' : v;
    }

    function updateBeanHint() {
      const el = $('#bean-hint', page);
      const bean = S.get('beans', d.beanId);
      if (!bean) {
        el.innerHTML = S.all('beans').length ? '' : '還沒有豆子資料，<a href="#/bean/new">先新增一支豆子</a>';
        return;
      }
      const parts = [];
      const rd = C.restDays(bean.roastDate, d.date);
      if (rd !== null) parts.push(`養豆第 <b>${rd}</b> 天`);
      const rem = remaining(bean);
      if (rem !== null) parts.push(`剩餘約 <b>${rem}</b> g`);
      let html = parts.length ? `<div>${parts.join(' · ')}</div>` : '';
      const prev = beanBrews(bean.id).filter((b) => b.id !== d.id && b.nextTime)[0];
      if (prev) html += `<div class="note">上次（${esc(fmtDate(prev.date))}）想調整：${esc(prev.nextTime)}</div>`;
      const best = bestBrew(bean.id, d.method, d.id);
      if (best) html += `<button type="button" class="btn small" data-act="apply-best" data-id="${best.id}">套用${best.isBest ? '最佳' : '評分最高'}配方：${esc(summary(best))}</button>`;
      el.innerHTML = html;
    }

    function updateGrindHint() {
      const el = $('#grind-hint', page);
      const g = S.get('grinders', d.grinderId);
      if (!S.all('grinders').length) {
        el.innerHTML = '<a href="#/grinder/new">新增磨豆機</a>後，換磨豆機時可以自動換算刻度。';
        return;
      }
      if (!g) { el.innerHTML = ''; return; }
      if (!C.canConvert(g)) {
        el.innerHTML = `這台磨豆機還沒設定「每格微米」，<a href="#/grinder/${g.id}/edit">設定後</a>即可換算刻度。`;
        return;
      }
      let html = grindNote ? `<div>${esc(grindNote)}</div>` : '';
      const mic = C.grinderMicrons(g, d.grindSetting);
      if (mic !== null) {
        const ms = C.methodsForMicrons(mic).map((r) => r.label);
        html += `<div>≈ <b>${mic}</b> µm${ms.length ? ' · 落在：' + ms.join('、') + ' 範圍' : ''}</div>`;
      }
      const r = C.grinderRangeTable(g).find((x) => x.key === METHODS[d.method].range);
      if (r) html += `<div class="muted">${METHODS[d.method].label}參考範圍：${r.from}–${r.to} ${esc(unitOf(g))}</div>`;
      el.innerHTML = html;
    }

    function updateRatioHint() {
      const el = $('#ratio-hint', page);
      if (d.method === 'espresso') {
        el.innerHTML = '常見比例：Ristretto 1:1–1.5 · 標準 1:2 · Lungo 1:3';
      } else if (d.method === 'moka') {
        el.innerHTML = '摩卡壺粉槽裝滿抹平（不壓實），水加到洩壓閥下方；常見約 1:7–1:10。';
      } else {
        const bev = C.estimatedBeverage(d.water, d.dose);
        el.innerHTML = bev !== null ? `預估萃取液約 <b>${bev}</b> g（咖啡粉約吸 2 倍水）` : '';
      }
    }

    function onOutChanged() {
      if (!METHODS[d.method].stages || !autoScale) return;
      if (C.stagesTotal(d.stages) > 0 && C.num(d.water)) {
        d.stages = C.scaleStages(d.stages, d.water);
        renderStages();
      }
    }

    function applyRecipe(src) {
      RECIPE_FIELDS.forEach((f) => { if (src[f] !== undefined) d[f] = src[f]; });
      d.stages = clone(src.stages || []);
    }

    function onInput(e) {
      const t = e.target;
      const isText = t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['checkbox', 'radio'].includes(t.type));
      if ((e.type === 'change') === isText) return; // 文字類用 input 事件、選單與勾選用 change 事件

      if (t.id === 'auto-scale') { autoScale = t.checked; return; }

      if (t.dataset.sf) {
        const s = d.stages[+t.closest('.stage').dataset.i];
        s[t.dataset.sf] = t.dataset.sf === 'amount' ? C.num(t.value) : t.value;
        updateStageSum();
        return;
      }

      const f = t.dataset.f;
      if (!f) return;
      const out = METHODS[d.method].out;

      if (f === 'method') {
        const keep = { beanId: d.beanId, grinderId: d.grinderId, grindSetting: d.grindSetting };
        Object.assign(d, methodDefaults(t.value), keep);
        const best = d.beanId && bestBrew(d.beanId, d.method, d.id);
        if (best) applyRecipe(best);
        draw();
        return;
      }

      if (f === 'grinderId') {
        const prev = S.get('grinders', d.grinderId);
        const next = S.get('grinders', t.value);
        d.grinderId = t.value;
        grindNote = '';
        if (prev && next && d.grindSetting) {
          const conv = C.convertGrind(prev, d.grindSetting, next);
          if (conv !== null) {
            grindNote = `已由 ${prev.name} ${d.grindSetting} ${unitOf(prev)} 自動換算`;
            d.grindSetting = String(conv);
            setVal('grindSetting', conv);
          }
        }
        updateGrindHint();
        return;
      }

      if (TASTE_KEYS.has(f)) {
        d[f] = C.num(t.value) || null;
        $('#o-' + f, page).textContent = d[f] || '—';
        return;
      }

      d[f] = NUM_FIELDS.has(f) ? C.num(t.value) : t.value;

      if (f === 'beanId' || f === 'date') updateBeanHint();
      if (f === 'grindSetting') { grindNote = ''; updateGrindHint(); }
      if (f === 'dose' || f === 'ratio') {
        const v = C.waterFromDose(d.dose, d.ratio);
        if (v !== null) { d[out] = v; setVal(out, v); onOutChanged(); }
      } else if (f === out) {
        const r = C.ratioOf(d.dose, d[out]);
        if (r !== null) { d.ratio = r; setVal('ratio', r); }
        onOutChanged();
      }
      updateRatioHint();
      updateStageSum();
    }

    function onClick(e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'tpl') {
        const t = C.POUR_TEMPLATES[b.dataset.k];
        if (d.stages.length && !confirm(`以「${t.label}」取代目前的分段？`)) return;
        d.stages = C.buildTemplate(b.dataset.k, d.dose, d.water);
        if (!d.stages.length) toast('請先填粉量與水量');
        renderStages();
      } else if (act === 'add-stage') {
        const lastStart = d.stages.length ? C.parseTime(d.stages[d.stages.length - 1].start) : null;
        d.stages.push({
          label: d.stages.length ? `第 ${d.stages.length + 1} 段` : '悶蒸',
          start: C.formatTime(lastStart === null ? 0 : lastStart + 30),
          amount: null,
          technique: '',
        });
        renderStages();
      } else if (act === 'del-stage') {
        d.stages.splice(+b.closest('.stage').dataset.i, 1);
        renderStages();
      } else if (act === 'rate') {
        const n = +b.dataset.n;
        d.rating = d.rating === n ? null : n;
        $$('.star', page).forEach((s) => s.classList.toggle('on', +s.dataset.n <= (d.rating || 0)));
      } else if (act === 'apply-best') {
        applyRecipe(S.get('brews', b.dataset.id));
        draw();
        toast('已套用配方');
      }
    }

    function onSubmit(e) {
      e.preventDefault();
      const rec = clone(d);
      rec.stages = (rec.stages || []).filter((s) => s.label || s.start || s.amount || s.technique);
      if (!METHODS[rec.method].stages) rec.stages = [];
      if (rec.totalTime) {
        const t = C.parseTime(rec.totalTime);
        if (t !== null) rec.totalTime = C.formatTime(t);
      }
      rec.stages.forEach((s) => {
        const t = C.parseTime(s.start);
        if (t !== null) s.start = C.formatTime(t);
      });
      S.upsert('brews', rec);
      location.hash = '#/brew/' + rec.id;
    }

    function bind() {
      const form = $('#brew-form', page);
      form.addEventListener('input', onInput);
      form.addEventListener('change', onInput);
      form.addEventListener('click', onClick);
      form.addEventListener('submit', onSubmit);
    }

    draw();
  }

  // ---------- 豆子 ----------

  function renderBeanList(q) {
    const showArchived = q.get('all') === '1';
    const beans = S.all('beans').filter((b) => showArchived || !b.archived)
      .sort((x, y) => String(y.roastDate || '').localeCompare(String(x.roastDate || '')));
    const archivedCount = S.all('beans').filter((b) => b.archived).length;

    mount(`<div class="page">
      ${header('豆子', { action: '<a class="btn primary small" href="#/bean/new">＋ 新增</a>' })}
      <div class="list">${beans.length ? beans.map((b) => {
        const brews = beanBrews(b.id);
        const rd = C.restDays(b.roastDate);
        const rem = remaining(b);
        const best = bestBrew(b.id);
        return `<a class="card bean-card ${b.archived ? 'archived' : ''}" href="#/bean/${b.id}">
          <div class="row"><strong class="grow">${esc(b.name)}</strong>${b.roast ? `<span class="tag">${esc(b.roast)}</span>` : ''}</div>
          <div class="meta">${esc([b.roaster, b.process].filter(Boolean).join(' · '))}</div>
          <div class="row small muted">
            ${rd !== null ? `<span>養豆 ${rd} 天</span>` : ''}
            ${rem !== null ? `<span>剩 ${rem}g</span>` : ''}
            <span>${brews.length} 筆記錄</span>
            ${best ? `<span class="best">最佳 ${esc(summary(best))}</span>` : ''}
          </div>
        </a>`;
      }).join('') : '<div class="empty"><p>還沒有豆子。</p><p><a class="btn primary" href="#/bean/new">新增第一支豆子</a></p></div>'}</div>
      ${archivedCount ? `<p class="center"><a href="#/beans${showArchived ? '' : '?all=1'}">${showArchived ? '隱藏' : '顯示'}已喝完的豆子（${archivedCount}）</a></p>` : ''}
    </div>`);
  }

  function renderBeanDetail(id) {
    const bean = S.get('beans', id);
    if (!bean) return notFound();
    const brews = beanBrews(id);
    const rd = C.restDays(bean.roastDate);
    const rem = remaining(bean);
    const methods = METHOD_KEYS.filter((k) => brews.some((b) => b.method === k));
    const info = [['烘豆商', bean.roaster], ['產區', bean.origin], ['品種', bean.variety], ['處理法', bean.process],
      ['烘焙度', bean.roast], ['烘焙日', bean.roastDate && `${bean.roastDate}（第 ${rd} 天）`],
      ['重量', bean.weight && `${bean.weight} g${rem !== null ? `，剩約 ${rem} g` : ''}`], ['價格', bean.price]]
      .filter((x) => x[1]);

    const page = mount(`<div class="page">
      ${header(bean.name, { back: '#/beans', action: `<a class="btn small" href="#/bean/${id}/edit">編輯</a>` })}
      <section class="card">
        <div class="stats">${info.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>
        ${bean.flavor ? `<p><b>風味標示：</b>${esc(bean.flavor)}</p>` : ''}
        ${bean.notes ? `<p class="muted">${esc(bean.notes)}</p>` : ''}
      </section>
      ${methods.map((k) => {
        const best = bestBrew(id, k);
        if (!best) return '';
        return `<section class="card best-card">
          <div class="card-head"><h2>${best.isBest ? '★ 最佳' : '評分最高的'}${METHODS[k].label}配方</h2>${stars(best.rating)}</div>
          <div class="meta">${esc(summary(best))}</div>
          ${stagesTable(best.stages)}
          ${best.nextTime ? `<p class="note">下次調整：${esc(best.nextTime)}</p>` : ''}
          <div class="actions">
            <a class="btn primary small" href="#/timer/${best.id}">⏱ 跟著計時</a>
            <a class="btn small" href="#/brew/new?from=${best.id}">用這個配方再沖</a>
            <a class="btn ghost small" href="#/brew/${best.id}">詳細</a>
          </div>
        </section>`;
      }).join('')}
      <div class="actions">
        <a class="btn primary" href="#/brew/new?bean=${id}">＋ 用這支豆子沖一杯</a>
        <button class="btn ghost" data-act="archive">${bean.archived ? '移回架上' : '標記為已喝完'}</button>
      </div>
      <h2 class="section-title">所有記錄（${brews.length}）</h2>
      <div class="list">${brews.map((b) => brewCard(b, { hideBean: true })).join('') || '<p class="muted">還沒有記錄。</p>'}</div>
      <p class="center"><button class="btn danger ghost small" data-act="del">刪除這支豆子</button></p>
    </div>`);

    page.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'archive') {
        bean.archived = !bean.archived;
        S.upsert('beans', bean);
        renderBeanDetail(id);
      } else if (act.dataset.act === 'del') {
        const msg = brews.length ? `這支豆子有 ${brews.length} 筆記錄，刪除後記錄會保留但顯示為「未指定豆子」。確定刪除？` : '確定刪除這支豆子？';
        if (confirm(msg)) { S.remove('beans', id); location.hash = '#/beans'; }
      }
    });
  }

  function renderBeanForm(id) {
    const editing = id ? S.get('beans', id) : null;
    if (id && !editing) return notFound();
    const b = editing ? clone(editing) : { roastDate: '' };
    const text = (f, label, ph, extra) => field(label, `<input name="${f}" value="${esc(b[f])}" placeholder="${esc(ph || '')}" ${extra || ''}>`);

    const page = mount(`<div class="page">
      ${header(editing ? '編輯豆子' : '新增豆子', { back: editing ? '#/bean/' + id : '#/beans' })}
      <form id="bean-form" autocomplete="off">
        <section class="card">
          ${text('name', '名稱 *', '例：衣索比亞 耶加雪菲 G1', 'required')}
          <div class="grid2">
            ${text('roaster', '烘豆商', '')}
            ${text('origin', '產區 / 莊園', '')}
            ${text('variety', '品種', '例：藝伎、SL28')}
            ${text('process', '處理法', '', 'list="process-list"')}
            ${field('烘焙度', `<select name="roast"><option value="">—</option>${ROASTS.map((r) => `<option ${b.roast === r ? 'selected' : ''}>${r}</option>`).join('')}</select>`)}
            ${field('烘焙日期', `<input type="date" name="roastDate" value="${esc(b.roastDate)}">`)}
            ${field('重量 g', `<input type="number" step="any" inputmode="decimal" name="weight" value="${esc(b.weight)}" placeholder="用來估算剩餘量">`)}
            ${text('price', '價格', '例：NT$ 450 / 200g')}
          </div>
          ${text('flavor', '風味標示', '例：茉莉花、檸檬、紅茶')}
          ${field('備註', `<textarea name="notes" rows="2">${esc(b.notes)}</textarea>`)}
        </section>
        <div class="form-actions">
          <a class="btn ghost" href="${editing ? '#/bean/' + id : '#/beans'}">取消</a>
          <button class="btn primary" type="submit">儲存</button>
        </div>
      </form>
      <datalist id="process-list">${PROCESSES.map((p) => `<option value="${p}">`).join('')}</datalist>
    </div>`);

    $('#bean-form', page).addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      fd.forEach((v, k) => { b[k] = k === 'weight' ? C.num(v) : String(v).trim(); });
      S.upsert('beans', b);
      location.hash = '#/bean/' + b.id;
    });
  }

  // ---------- 計時器 ----------

  function renderTimer(id) {
    if (!id) return renderTimerPicker();
    const free = id === 'free';
    const brew = free ? null : S.get('brews', id);
    if (!free && !brew) return notFound();

    const stages = brew ? (brew.stages || []).filter((s) => C.parseTime(s.start) !== null) : [];
    const cum = C.cumulative(stages);
    const target = brew ? C.parseTime(brew.totalTime) : null;

    const page = mount(`<div class="page timer-page">
      ${header('計時沖煮', { back: brew ? '#/brew/' + id : '#/timer' })}
      <section class="card center">
        <div class="muted">${brew ? esc(beanName(brew.beanId)) + ' · ' + esc(summary(brew)) : '自由計時：每次開始注水時按「分段」'}</div>
        <div id="clock" class="clock">0:00</div>
        ${target !== null ? `<div class="muted">目標總時間 ${esc(brew.totalTime)}</div>` : ''}
      </section>
      ${stages.length ? '<section class="card now" id="now"></section>' : ''}
      <div class="timer-controls">
        <button class="btn" id="reset">重設</button>
        <button class="btn primary big" id="toggle">開始</button>
        ${free ? '<button class="btn" id="lap" disabled>分段</button>' : ''}
      </div>
      ${stages.length ? `<ol class="stage-list" id="slist">${stages.map((s, i) => `<li>
        <span class="mono">${esc(s.start)}</span>
        <span class="grow">${esc(s.label || `第 ${i + 1} 段`)}${s.technique ? `<small>${esc(s.technique)}</small>` : ''}</span>
        <span class="r mono">${s.amount ? '+' + esc(s.amount) + 'g' : ''}<small>→ ${cum[i]}g</small></span></li>`).join('')}</ol>` : ''}
      ${free ? '<ol class="stage-list" id="laps"></ol>' : ''}
      <label class="check center-check"><input type="checkbox" id="sound" checked> 段落提示音與震動</label>
      <button class="btn block" id="finish">完成，存成記錄</button>
    </div>`);

    const clock = $('#clock', page);
    const now = $('#now', page);
    const toggleBtn = $('#toggle', page);
    const lapBtn = $('#lap', page);
    let running = false;
    let startAt = 0;
    let acc = 0;
    let timerId = null;
    let lastIdx = -1;
    let lastCount = '';
    let targetCued = false;
    let laps = [];
    let audio = null;
    let wakeLock = null;

    const elapsed = () => acc + (running ? (performance.now() - startAt) / 1000 : 0);
    const soundOn = () => $('#sound', page).checked;

    function beep(freq, dur) {
      if (!soundOn()) return;
      try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.25, audio.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
        o.connect(g).connect(audio.destination);
        o.start();
        o.stop(audio.currentTime + dur);
      } catch (e) { /* 不支援音效就略過 */ }
    }

    function buzz(ms) {
      if (soundOn() && navigator.vibrate) navigator.vibrate(ms);
    }

    function renderNow(t) {
      if (!now) return;
      const idx = C.stageIndexAt(stages, t);
      const cur = idx >= 0 ? stages[idx] : null;
      const next = stages[idx + 1];
      let html = cur
        ? `<div class="now-label">${esc(cur.label || `第 ${idx + 1} 段`)}</div>
           <div class="now-amount">注水 <b>${cur.amount ? esc(cur.amount) : '—'}</b> g → 累計 <b>${cum[idx]}</b> g</div>
           ${cur.technique ? `<div class="now-tech">${esc(cur.technique)}</div>` : ''}`
        : '<div class="now-label">準備</div>';
      if (next) {
        const left = Math.max(0, Math.ceil(C.parseTime(next.start) - t));
        html += `<div class="now-next">下一段「${esc(next.label || '')}」${esc(next.start)} 開始，還有 <b>${left}</b> 秒</div>`;
      }
      now.innerHTML = html;
      $$('#slist li', page).forEach((li, i) => {
        li.classList.toggle('active', i === idx);
        li.classList.toggle('done', i < idx);
      });
    }

    function tick() {
      const t = elapsed();
      clock.textContent = C.formatTime(Math.floor(t));
      if (target !== null) clock.classList.toggle('over', t >= target);
      if (running && target !== null && !targetCued && t >= target) {
        targetCued = true;
        beep(988, 0.15);
        setTimeout(() => beep(988, 0.3), 220);
      }
      if (!stages.length) return;
      const idx = C.stageIndexAt(stages, t);
      if (running) {
        if (idx !== lastIdx && idx >= 0) { beep(880, 0.35); buzz(300); }
        lastIdx = idx;
        const next = stages[idx + 1];
        if (next) {
          const left = Math.ceil(C.parseTime(next.start) - t);
          const key = idx + ':' + left;
          if (left >= 1 && left <= 3 && key !== lastCount) { lastCount = key; beep(660, 0.08); }
        }
      }
      renderNow(t);
    }

    async function keepAwake(on) {
      try {
        if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
        else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
      } catch (e) { /* 不支援就略過 */ }
    }

    function renderLaps() {
      const el = $('#laps', page);
      if (el) el.innerHTML = laps.map((t, i) => `<li><span class="mono">${C.formatTime(t)}</span><span class="grow">${i === 0 ? '悶蒸' : `第 ${i + 1} 段`}</span></li>`).join('');
    }

    function start() {
      running = true;
      startAt = performance.now();
      if (free && !laps.length) { laps.push(0); renderLaps(); }
      toggleBtn.textContent = '暫停';
      if (lapBtn) lapBtn.disabled = false;
      timerId = setInterval(tick, 200);
      keepAwake(true);
      tick();
    }

    function pause() {
      acc = elapsed();
      running = false;
      clearInterval(timerId);
      toggleBtn.textContent = '繼續';
      keepAwake(false);
    }

    function reset() {
      pause();
      acc = 0;
      lastIdx = -1;
      lastCount = '';
      targetCued = false;
      laps = [];
      renderLaps();
      toggleBtn.textContent = '開始';
      if (lapBtn) lapBtn.disabled = true;
      tick();
    }

    toggleBtn.addEventListener('click', () => (running ? pause() : start()));
    $('#reset', page).addEventListener('click', reset);
    if (lapBtn) lapBtn.addEventListener('click', () => { laps.push(Math.floor(elapsed())); renderLaps(); beep(880, 0.1); });
    $('#finish', page).addEventListener('click', () => {
      const t = Math.round(elapsed());
      pause();
      if (brew) {
        location.hash = `#/brew/new?from=${id}${t ? '&time=' + t : ''}`;
      } else {
        pending = {
          method: 'pourover',
          totalTime: t ? C.formatTime(t) : '',
          stages: laps.map((s, i) => ({ label: i === 0 ? '悶蒸' : `第 ${i + 1} 段`, start: C.formatTime(s), amount: null, technique: '' })),
        };
        location.hash = '#/brew/new?pending=1';
      }
    });

    cleanup = () => { clearInterval(timerId); keepAwake(false); if (audio) audio.close(); };
    tick();
  }

  function renderTimerPicker() {
    const brews = S.all('brews').slice().sort(byDateDesc);
    const best = brews.filter((b) => b.isBest);
    const recent = brews.filter((b) => !b.isBest).slice(0, 8);
    mount(`<div class="page">
      ${header('計時沖煮')}
      <a class="card link-card" href="#/timer/free"><strong>自由計時</strong><div class="muted small">邊沖邊按「分段」，結束後自動帶入記錄的分段時間</div></a>
      ${best.length ? `<h2 class="section-title">★ 最佳配方</h2><div class="list">${best.map((b) => brewCard(b).replace('#/brew/', '#/timer/')).join('')}</div>` : ''}
      ${recent.length ? `<h2 class="section-title">最近的記錄</h2><div class="list">${recent.map((b) => brewCard(b).replace('#/brew/', '#/timer/')).join('')}</div>` : ''}
      ${!brews.length ? '<p class="empty">存了記錄之後，就能在這裡跟著分段時間與水量計時沖煮。</p>' : ''}
    </div>`);
  }

  // ---------- 工具 ----------

  function renderTools(q) {
    const t = q.get('t') || 'ratio';
    const tabs = [['ratio', '水粉比'], ['scale', '配方縮放'], ['grind', '研磨換算']];
    const page = mount(`<div class="page">
      ${header('工具')}
      <div class="seg tabs">${tabs.map(([k, l]) => `<a class="${t === k ? 'on' : ''}" href="#/tools?t=${k}">${l}</a>`).join('')}</div>
      <div id="tool"></div>
    </div>`);
    const el = $('#tool', page);
    if (t === 'scale') scaleTool(el);
    else if (t === 'grind') grindTool(el);
    else ratioTool(el);
  }

  function ratioTool(el) {
    const st = { dose: 15, ratio: 16, water: 240 };
    el.innerHTML = `<section class="card">
      <div class="chips">${RATIO_PRESETS.map(([l, r]) => `<button type="button" class="chip" data-ratio="${r}">${l}</button>`).join('')}</div>
      <div class="grid3">
        ${field('粉量 g', '<input type="number" step="any" inputmode="decimal" id="rt-dose">')}
        ${field('水粉比 1:', '<input type="number" step="any" inputmode="decimal" id="rt-ratio">')}
        ${field('水量 / 萃取量 g', '<input type="number" step="any" inputmode="decimal" id="rt-water">')}
      </div>
      <p class="muted small">改粉量或比例 → 算水量；改水量 → 依比例反推粉量。</p>
      <div id="rt-out" class="hint"></div>
      <table class="table" id="rt-table"></table>
    </section>`;
    const inp = { dose: $('#rt-dose', el), ratio: $('#rt-ratio', el), water: $('#rt-water', el) };

    function show(except) {
      Object.keys(inp).forEach((k) => { if (k !== except) inp[k].value = st[k] === null ? '' : st[k]; });
      const bev = st.ratio >= 8 ? C.estimatedBeverage(st.water, st.dose) : null;
      $('#rt-out', el).innerHTML = bev !== null ? `濾泡式預估萃取液約 <b>${bev}</b> g` : '';
      const ratios = st.ratio >= 8 ? [13, 14, 15, 16, 17, 18] : [1.5, 2, 2.5, 3];
      $('#rt-table', el).innerHTML = `<thead><tr><th>比例</th><th class="r">${esc(st.dose || '—')}g 粉 → 水</th><th class="r">${esc(st.water || '—')}g 水 → 粉</th></tr></thead>
        <tbody>${ratios.map((r) => `<tr class="${r === st.ratio ? 'hl' : ''}"><td>1:${r}</td><td class="r mono">${C.waterFromDose(st.dose, r) ?? '—'}</td><td class="r mono">${C.doseFromWater(st.water, r) ?? '—'}</td></tr>`).join('')}</tbody>`;
    }

    el.addEventListener('input', (e) => {
      const k = Object.keys(inp).find((x) => inp[x] === e.target);
      if (!k) return;
      st[k] = C.num(e.target.value);
      if (k === 'water') st.dose = C.doseFromWater(st.water, st.ratio);
      else st.water = C.waterFromDose(st.dose, st.ratio);
      show(k);
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ratio]');
      if (!b) return;
      st.ratio = +b.dataset.ratio;
      if (st.ratio < 8 && st.dose > 22) st.dose = 18; // 切到義式時給個合理粉量
      st.water = C.waterFromDose(st.dose, st.ratio);
      show();
    });
    show();
  }

  function scaleTool(el) {
    const brews = S.all('brews').filter((b) => b.stages && b.stages.length).sort(byDateDesc);
    if (!brews.length) {
      el.innerHTML = '<p class="empty">需要至少一筆有分段注水的記錄，才能等比例縮放配方。</p>';
      return;
    }
    const first = brews.find((b) => b.isBest) || brews[0];
    el.innerHTML = `<section class="card">
      ${field('原配方', `<select id="sc-brew">${brews.map((b) => `<option value="${b.id}" ${b.id === first.id ? 'selected' : ''}>${b.isBest ? '★ ' : ''}${esc(beanName(b.beanId))} · ${esc(summary(b))}</option>`).join('')}</select>`)}
      <div class="grid2">
        ${field('新的粉量 g', '<input type="number" step="any" inputmode="decimal" id="sc-dose">')}
        ${field('水粉比 1:', '<input type="number" step="any" inputmode="decimal" id="sc-ratio">')}
      </div>
      <div id="sc-out"></div>
      <button class="btn primary block" id="sc-use">用縮放後的配方新增記錄</button>
    </section>`;
    const sel = $('#sc-brew', el);
    const doseIn = $('#sc-dose', el);
    const ratioIn = $('#sc-ratio', el);
    let result = null;

    function load() {
      const b = S.get('brews', sel.value);
      doseIn.value = b.dose || '';
      ratioIn.value = b.ratio || C.ratioOf(b.dose, C.stagesTotal(b.stages)) || '';
      calc();
    }
    function calc() {
      const b = S.get('brews', sel.value);
      const dose = C.num(doseIn.value);
      const water = C.waterFromDose(dose, ratioIn.value);
      if (water === null) { $('#sc-out', el).innerHTML = ''; result = null; return; }
      const stages = C.scaleStages(b.stages, water);
      result = { src: b, dose, ratio: C.num(ratioIn.value), water, stages };
      $('#sc-out', el).innerHTML = `<p>總水量 <b>${water}</b> g（原 ${b.water || C.stagesTotal(b.stages)} g）</p>${stagesTable(stages)}`;
    }
    sel.addEventListener('change', load);
    doseIn.addEventListener('input', calc);
    ratioIn.addEventListener('input', calc);
    $('#sc-use', el).addEventListener('click', () => {
      if (!result) return;
      const p = { beanId: result.src.beanId };
      RECIPE_FIELDS.forEach((f) => { if (result.src[f] !== undefined) p[f] = result.src[f]; });
      Object.assign(p, { dose: result.dose, ratio: result.ratio, water: result.water, stages: result.stages });
      pending = p;
      location.hash = '#/brew/new?pending=1';
    });
    load();
  }

  function grindTool(el) {
    const all = S.all('grinders');
    const gs = all.filter(C.canConvert);
    const presetButtons = C.GRINDER_PRESETS.filter((p) => !all.some((g) => g.name === p.name))
      .map((p) => `<button type="button" class="chip" data-preset="${p.key}">＋ ${esc(p.name)}</button>`).join('');

    if (!gs.length) {
      el.innerHTML = `<section class="card">
        <p>研磨換算需要至少一台設定了「每格微米」的磨豆機。可以直接加入常見機型（數值為參考值）：</p>
        <div class="chips">${presetButtons}</div>
        <p><a href="#/grinder/new">或自訂磨豆機</a></p>
      </section>`;
      el.onclick = (e) => {
        const b = e.target.closest('[data-preset]');
        if (b) { addPreset(b.dataset.preset); grindTool(el); }
      };
      return;
    }

    const opts = (sel) => gs.map((g) => `<option value="${g.id}" ${g.id === sel ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
    el.innerHTML = `<section class="card"><h2>刻度換算</h2>
        <div class="grid2">
          ${field('磨豆機', `<select id="gd-from">${opts(gs[0].id)}</select>`)}
          ${field('刻度', '<input id="gd-set" inputmode="decimal" placeholder="例：24">')}
        </div>
        <div id="gd-out" class="hint"></div>
        <table class="table" id="gd-table"></table>
      </section>
      <section class="card"><h2>各沖煮法建議刻度</h2>
        <p class="muted small">依常見粒徑範圍換算，只是起點，實際依口感微調。</p>
        <div class="scroll-x"><table class="table">
          <thead><tr><th>沖煮法</th><th class="r">µm</th>${gs.map((g) => `<th class="r">${esc(g.name)}</th>`).join('')}</tr></thead>
          <tbody>${C.METHOD_RANGES.map((r) => `<tr><td>${r.label}</td><td class="r mono">${r.min}–${r.max}</td>${gs.map((g) => `<td class="r mono">${C.grinderSetting(g, r.min)}–${C.grinderSetting(g, r.max)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
      </section>
      ${gs.length > 1 ? `<section class="card"><h2>同杯校正</h2>
        <p class="muted small">兩台磨出來口感相同時，記下各自的刻度，就能讓換算更貼近你手上的機器（會調整第二台的零點）。</p>
        <div class="grid2">
          ${field('磨豆機 A', `<select id="cb-a">${opts(gs[0].id)}</select>`)}
          ${field('A 的刻度', '<input id="cb-as" inputmode="decimal">')}
          ${field('磨豆機 B（要校正）', `<select id="cb-b">${opts(gs[1].id)}</select>`)}
          ${field('B 的刻度', '<input id="cb-bs" inputmode="decimal">')}
        </div>
        <button class="btn block" id="cb-go">校正 B</button>
      </section>` : ''}
      ${presetButtons ? `<section class="card"><h2>加入其他常見磨豆機</h2><div class="chips">${presetButtons}</div></section>` : ''}`;

    function calc() {
      const from = S.get('grinders', $('#gd-from', el).value);
      const set = $('#gd-set', el).value;
      const mic = C.grinderMicrons(from, set);
      if (mic === null) { $('#gd-out', el).innerHTML = ''; $('#gd-table', el).innerHTML = ''; return; }
      const ms = C.methodsForMicrons(mic).map((r) => r.label);
      $('#gd-out', el).innerHTML = `≈ <b>${mic}</b> µm${ms.length ? ' · 落在：' + ms.join('、') + ' 範圍' : ''}`;
      const others = gs.filter((g) => g.id !== from.id);
      $('#gd-table', el).innerHTML = others.length
        ? `<tbody>${others.map((g) => `<tr><td>${esc(g.name)}</td><td class="r mono"><b>${C.grinderSetting(g, mic)}</b> ${esc(unitOf(g))}</td></tr>`).join('')}</tbody>`
        : '';
    }
    $('#gd-from', el).addEventListener('change', calc);
    $('#gd-set', el).addEventListener('input', calc);

    const cb = $('#cb-go', el);
    if (cb) cb.addEventListener('click', () => {
      const a = S.get('grinders', $('#cb-a', el).value);
      const b = S.get('grinders', $('#cb-b', el).value);
      if (a.id === b.id) return toast('請選兩台不同的磨豆機');
      const zero = C.calibrateZero(a, $('#cb-as', el).value, b, $('#cb-bs', el).value);
      if (zero === null) return toast('請填寫兩邊的刻度');
      if (!confirm(`把「${b.name}」的零點偏移由 ${b.zeroMicrons || 0} µm 改為 ${zero} µm？`)) return;
      b.zeroMicrons = zero;
      S.upsert('grinders', b);
      toast('已校正');
      grindTool(el);
    });
    el.onclick = (e) => {
      const b = e.target.closest('[data-preset]');
      if (b) { addPreset(b.dataset.preset); grindTool(el); }
    };
  }

  function addPreset(key) {
    const p = C.GRINDER_PRESETS.find((x) => x.key === key);
    if (!p) return;
    S.upsert('grinders', { name: p.name, unit: '格', micronsPerStep: p.micronsPerStep, zeroMicrons: p.zeroMicrons, precision: p.precision, notes: '預設參考值，可依實際校正' });
    toast('已加入 ' + p.name);
  }

  // ---------- 設定 ----------

  function renderSettings() {
    const grinders = S.all('grinders');
    const presets = C.GRINDER_PRESETS.filter((p) => !grinders.some((g) => g.name === p.name));
    const page = mount(`<div class="page">
      ${header('設定')}
      <section class="card"><div class="card-head"><h2>磨豆機</h2><a class="btn small" href="#/grinder/new">＋ 自訂</a></div>
        <div class="list tight">${grinders.map((g) => `<a class="item" href="#/grinder/${g.id}/edit">
          <strong>${esc(g.name)}</strong>
          <span class="muted small">${C.canConvert(g) ? `每${esc(unitOf(g))} ${g.micronsPerStep} µm${g.zeroMicrons ? `，零點 ${g.zeroMicrons} µm` : ''}` : '未設定換算'}</span></a>`).join('') || '<p class="muted">還沒有磨豆機。</p>'}</div>
        ${presets.length ? `<p class="muted small">快速加入常見機型（每格微米為參考值）：</p><div class="chips">${presets.map((p) => `<button type="button" class="chip" data-preset="${p.key}">＋ ${esc(p.name)}</button>`).join('')}</div>` : ''}
      </section>

      <section class="card"><h2>資料與備份</h2>
        <p class="muted small">資料只存在這台裝置的瀏覽器裡。換手機、清除瀏覽資料前，請先匯出備份。</p>
        <p>${S.all('beans').length} 支豆子 · ${S.all('brews').length} 筆記錄 · ${grinders.length} 台磨豆機</p>
        <div class="actions">
          <button class="btn primary" data-act="export">匯出備份 (JSON)</button>
          <button class="btn" data-act="import-merge">匯入（合併）</button>
          <button class="btn" data-act="import-replace">匯入（取代全部）</button>
        </div>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </section>

      <section class="card"><h2>其他</h2>
        <div class="actions">
          <button class="btn" data-act="sample">載入範例資料</button>
          <button class="btn danger ghost" data-act="clear">清除所有資料</button>
        </div>
        <p class="muted small">研磨粒徑與各沖煮法範圍為常見參考值，不同豆子、烘焙度與器材都會影響，請以口感為準。</p>
      </section>
    </div>`);

    let importMode = 'merge';
    const file = $('#import-file', page);
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        if (importMode === 'replace' && !confirm('會用備份檔取代目前所有資料，確定？')) return;
        const n = S.importJSON(text, importMode);
        toast(`已匯入 ${n} 筆資料`);
        renderSettings();
      } catch (e) {
        alert('匯入失敗：' + e.message);
      } finally {
        file.value = '';
      }
    });

    page.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act],[data-preset]');
      if (!b) return;
      if (b.dataset.preset) { addPreset(b.dataset.preset); renderSettings(); return; }
      const act = b.dataset.act;
      if (act === 'export') {
        download(`coffee-log-${nowLocal().slice(0, 10)}.json`, S.exportJSON());
      } else if (act === 'import-merge' || act === 'import-replace') {
        importMode = act === 'import-merge' ? 'merge' : 'replace';
        file.click();
      } else if (act === 'sample') {
        loadSample();
        toast('已載入範例資料');
        location.hash = '#/brews';
      } else if (act === 'clear') {
        if (confirm('確定清除所有豆子、記錄與磨豆機？建議先匯出備份。') && confirm('真的要清除嗎？此動作無法復原。')) {
          S.clear();
          renderSettings();
        }
      }
    });
  }

  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function renderGrinderForm(id) {
    const editing = id ? S.get('grinders', id) : null;
    if (id && !editing) return notFound();
    const g = editing ? clone(editing) : { unit: '格', precision: 1, zeroMicrons: 0 };

    const page = mount(`<div class="page">
      ${header(editing ? '編輯磨豆機' : '新增磨豆機', { back: '#/settings' })}
      <form id="g-form" autocomplete="off">
        <section class="card">
          ${field('名稱 *', `<input name="name" required value="${esc(g.name)}" placeholder="例：Comandante C40">`)}
          <div class="grid2">
            ${field('刻度單位', `<input name="unit" value="${esc(unitOf(g))}" placeholder="格 / 圈 / 檔">`)}
            ${field('刻度精度', `<select name="precision">${[[1, '整數'], [0.5, '0.5'], [0.1, '0.1']].map(([v, l]) => `<option value="${v}" ${+g.precision === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
            ${field('每格約幾 µm', `<input type="number" step="any" inputmode="decimal" name="micronsPerStep" value="${esc(g.micronsPerStep)}" placeholder="例：30">`)}
            ${field('零點偏移 µm', `<input type="number" step="any" inputmode="decimal" name="zeroMicrons" value="${esc(g.zeroMicrons)}" placeholder="0">`)}
          </div>
          <p class="muted small">換算模型：粒徑 ≈ 零點偏移 + 每格 µm × 刻度。刻度請用「從歸零起算的總格數」。不知道每格微米可以先留空，一樣能記錄刻度，只是不能換算。</p>
          ${field('備註', `<textarea name="notes" rows="2">${esc(g.notes)}</textarea>`)}
          <div id="g-preview"></div>
        </section>
        <div class="form-actions">
          ${editing ? '<button type="button" class="btn danger ghost" data-act="del">刪除</button>' : ''}
          <a class="btn ghost" href="#/settings">取消</a>
          <button class="btn primary" type="submit">儲存</button>
        </div>
      </form>
    </div>`);

    const form = $('#g-form', page);
    function read() {
      const fd = new FormData(form);
      g.name = String(fd.get('name')).trim();
      g.unit = String(fd.get('unit')).trim();
      g.precision = C.num(fd.get('precision')) || 1;
      g.micronsPerStep = C.num(fd.get('micronsPerStep'));
      g.zeroMicrons = C.num(fd.get('zeroMicrons')) || 0;
      g.notes = String(fd.get('notes'));
    }
    function preview() {
      read();
      const rows = C.grinderRangeTable(g);
      $('#g-preview', page).innerHTML = rows.length
        ? `<table class="table"><thead><tr><th>沖煮法</th><th class="r">建議刻度</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.label}</td><td class="r mono">${r.from}–${r.to} ${esc(g.unit)}</td></tr>`).join('')}</tbody></table>`
        : '';
    }
    form.addEventListener('input', preview);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      read();
      S.upsert('grinders', g);
      location.hash = '#/settings';
    });
    form.addEventListener('click', (e) => {
      if (!e.target.closest('[data-act="del"]')) return;
      const used = S.all('brews').filter((b) => b.grinderId === id).length;
      if (confirm(used ? `有 ${used} 筆記錄用到這台磨豆機，刪除後那些記錄只會保留刻度數字。確定刪除？` : '確定刪除這台磨豆機？')) {
        S.remove('grinders', id);
        location.hash = '#/settings';
      }
    });
    preview();
  }

  // ---------- 範例資料 ----------

  function loadSample() {
    const c40 = S.upsert('grinders', { name: 'Comandante C40 MK4', unit: '格', micronsPerStep: 30, zeroMicrons: 0, precision: 1, notes: '範例' });
    S.upsert('grinders', { name: '1Zpresso JX-Pro', unit: '格', micronsPerStep: 12.5, zeroMicrons: 0, precision: 1, notes: '範例' });
    const yirga = S.upsert('beans', {
      name: '衣索比亞 耶加雪菲 G1（範例）', roaster: '範例烘豆坊', origin: '衣索比亞 耶加雪菲', variety: '原生種',
      process: '水洗', roast: '淺焙', roastDate: dateOffset(-10), weight: 200, flavor: '茉莉花、檸檬、紅茶',
    });
    const brazil = S.upsert('beans', {
      name: '巴西 喜拉朵（範例）', roaster: '範例烘豆坊', origin: '巴西 喜拉朵', process: '日曬', roast: '中深焙',
      roastDate: dateOffset(-15), weight: 250, flavor: '堅果、可可、焦糖',
    });
    const day = (n, hm) => dateOffset(n) + 'T' + hm;
    S.upsert('brews', {
      method: 'pourover', date: day(-3, '08:20'), beanId: yirga.id, grinderId: c40.id, grindSetting: '26',
      dose: 15, ratio: 16, water: 240, temp: 93, dripper: 'Hario V60 02', filter: '錐形', totalTime: '2:40',
      stages: C.buildTemplate('three', 15, 240), rating: 3, acidity: 4, sweetness: 2, bitterness: 1, body: 2,
      flavorNotes: '檸檬、花香', notes: '酸很明亮但甜感不夠，尾段偏薄', nextTime: '磨細 2 格，水溫維持 93°C',
    });
    S.upsert('brews', {
      method: 'pourover', date: day(-1, '08:15'), beanId: yirga.id, grinderId: c40.id, grindSetting: '24',
      dose: 15, ratio: 16, water: 240, temp: 93, dripper: 'Hario V60 02', filter: '錐形', totalTime: '2:55',
      stages: C.buildTemplate('three', 15, 240), rating: 5, acidity: 4, sweetness: 4, bitterness: 1, body: 3,
      flavorNotes: '茉莉花、檸檬紅茶、蜂蜜', notes: '甜感出來了，很乾淨', isBest: true,
    });
    S.upsert('brews', {
      method: 'moka', date: day(0, '07:50'), beanId: brazil.id, grinderId: c40.id, grindSetting: '15',
      dose: 16, ratio: 9.4, water: 150, dripper: 'Bialetti 3 杯份', waterStart: '熱水', heat: '中小火', flowStart: '1:50',
      totalTime: '3:10', rating: 4, bitterness: 3, body: 4, sweetness: 3, flavorNotes: '可可、焦糖', nextTime: '流出變快時早點離火',
    });
  }

  // ---------- 啟動 ----------

  S.load();
  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
