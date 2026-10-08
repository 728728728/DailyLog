/* ============================================
   DailyLog — 印刷スタジオ
   プレビューで実寸レイアウトを計算し、そのまま印刷する。
   - 1日1ページ: 文字が溢れたら自動で縮小、それでも無理なら続きページへ
   - 2段組・連続: 行単位で段・ページをまたいで流し込む
   - 一覧表（横）: 縮小しても入らなければ日数を分割
   ============================================ */

const PS_DEFAULTS = {
  layout: 'daily',
  rangeMode: 'week',
  fields: { objective: true, done: true, achieved: true, insights: true, issues: true, next: true, references: false, consultation: true },
  merge: true,
  cover: true,
  skipEmpty: true,
  comment: false,
  stamp: false,
  color: true,
  weekends: 'auto',
  font: 'sans',
  title: '',
  affiliation: '',
  author: '',
  figures: true,
  figPlacement: 'page',   // page: 別ページに大きく / inline: 本文の中に
  figSize: 'auto',
};

const PS_FIG_SCALE = { small: 0.75, auto: 1, large: 1.3 };
const PS_FIG_PER_PAGE = { large: 1, auto: 2, small: 4 }; // 別ページのとき

const PS_FONT_MAX = 9.5;   // pt
const PS_FONT_MIN = 6.5;   // pt
const PS_TABLE_MIN = 5.5;  // pt

let ps = null;             // 現在の設定（+ from/to）
let _psRenderTimer = null;
let _psReturnFocus = null;

function psSettings() {
  const saved = (state.settings && state.settings.print) || {};
  return {
    ...PS_DEFAULTS,
    ...saved,
    fields: { ...PS_DEFAULTS.fields, ...(saved.fields || {}) },
  };
}

function psPersist() {
  const { from, to, ...rest } = ps;
  state.settings.print = rest;
  saveSettings();
}

// ===== 期間 =====
function psRangeFor(mode, anchor) {
  const a = parseISO(anchor);
  if (mode === 'day') return { from: anchor, to: anchor };
  if (mode === 'month') {
    return {
      from: formatDateISO(new Date(a.getFullYear(), a.getMonth(), 1)),
      to: formatDateISO(new Date(a.getFullYear(), a.getMonth() + 1, 0)),
    };
  }
  const monday = new Date(a);
  monday.setDate(a.getDate() - ((a.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: formatDateISO(monday), to: formatDateISO(sunday) };
}

function psShiftRange(dir) {
  if (ps.rangeMode === 'custom') {
    const span = Math.round((parseISO(ps.to) - parseISO(ps.from)) / 86400000) + 1;
    ps.from = addDaysISO(ps.from, dir * span);
    ps.to = addDaysISO(ps.to, dir * span);
  } else if (ps.rangeMode === 'month') {
    const f = parseISO(ps.from);
    Object.assign(ps, psRangeFor('month', formatDateISO(new Date(f.getFullYear(), f.getMonth() + dir, 1))));
  } else {
    Object.assign(ps, psRangeFor(ps.rangeMode, addDaysISO(ps.from, dir * (ps.rangeMode === 'day' ? 1 : 7))));
  }
}

function psDates() {
  const out = [];
  if (!ps.from || !ps.to || ps.from > ps.to) return out;
  let cur = ps.from;
  let guard = 0;
  while (cur <= ps.to && guard++ < 400) {
    const dow = parseISO(cur).getDay();
    const weekend = dow === 0 || dow === 6;
    const has = hasContent(state.reports[cur]);
    let include = true;
    if (weekend && ps.rangeMode !== 'day') {
      if (ps.weekends === 'never') include = false;
      if (ps.weekends === 'auto') include = has;
    }
    if (include && ps.skipEmpty && !has && ps.rangeMode !== 'day') include = false;
    if (include) out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}

function psAutoTitle() {
  if (ps.title.trim()) return ps.title.trim();
  return { day: '日報', week: '週間日報', month: '月間日報', custom: '活動報告' }[ps.rangeMode] || '日報';
}

// ===== 表示用ラベル =====
function psDateLong(key) {
  const d = parseISO(key);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${DAYS_JP[d.getDay()]}）`;
}

function psDateShort(key) {
  const d = parseISO(key);
  return `${d.getMonth() + 1}/${d.getDate()}（${DAYS_JP[d.getDay()]}）`;
}

function psPeriodLabel() {
  const f = parseISO(ps.from);
  const t = parseISO(ps.to);
  if (ps.from === ps.to) return psDateLong(ps.from);
  const left = `${f.getFullYear()}年${f.getMonth() + 1}月${f.getDate()}日（${DAYS_JP[f.getDay()]}）`;
  const right = f.getFullYear() === t.getFullYear()
    ? `${t.getMonth() + 1}月${t.getDate()}日（${DAYS_JP[t.getDay()]}）`
    : `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日（${DAYS_JP[t.getDay()]}）`;
  return `${left} 〜 ${right}`;
}

// ===== 印刷ブロック（項目）の組み立て =====
function psBlocks(report) {
  const blocks = [];
  const f = ps.fields;
  SECTIONS.forEach(s => {
    if (!f[s.key]) return;
    if (ps.merge && (s.key === 'issues' || s.key === 'next')) {
      if (s.key === 'next' && f.issues) return; // 統合済み
      if (s.key === 'issues' && f.next) {
        const iss = (report.issues || '').trim();
        const nxt = (report.next || '').trim();
        let text = '';
        if (iss) text += `【課題点】\n${iss}`;
        if (nxt) text += `${text ? '\n' : ''}【次回につなげること】\n${nxt}`;
        blocks.push({ key: 'issues_next', label: '課題点 ＆ 次回につなげること', color: s.color, text });
        return;
      }
    }
    blocks.push({ key: s.key, label: s.label, color: s.color, text: (report[s.key] || '').trim() });
  });
  return blocks;
}

function psInline(str) {
  return escapeHtml(str)
    .replace(/【([^】]{1,30})】/g, '<b>【$1】</b>')
    .replace(/(→|⇒)/g, '<span class="ps-arrow">$1</span>');
}

// テキスト → 行HTMLの配列（箇条書きはぶら下げインデント）
function psLines(text) {
  if (!text) return [];
  return text.split('\n').map(raw => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) return '<p class="ps-line ps-gap"></p>';
    const m = line.match(/^(\s*)(・|[-*•]\s|(\d+)[.．)）]\s?)(.*)$/);
    if (m) {
      const depth = Math.min(3, Math.floor(m[1].replace(/　/g, '  ').length / 2));
      const mark = m[3] ? `${m[3]}.` : '・';
      return `<p class="ps-line ps-bullet" style="--d:${depth}"><span class="ps-mark">${mark}</span>${psInline(m[4])}</p>`;
    }
    return `<p class="ps-line">${psInline(line)}</p>`;
  });
}

function psSectionShell(block, { cont = false } = {}) {
  const el = document.createElement('section');
  el.className = 'ps-sec' + (block.text ? '' : ' ps-empty');
  el.dataset.key = block.key;
  el.style.setProperty('--c', block.color);
  el.innerHTML = `<h4 class="ps-sec-title">${escapeHtml(block.label)}${cont ? '<span class="ps-cont">（続き）</span>' : ''}</h4><div class="ps-sec-body"></div>`;
  return el;
}

// ===== ページの器 =====
function psNewPage(stage, { landscape = false, kind = '' } = {}) {
  const frame = document.createElement('div');
  frame.className = 'ps-frame' + (landscape ? ' is-landscape' : '');
  const page = document.createElement('div');
  page.className = `ps-page ${landscape ? 'ps-landscape' : 'ps-portrait'} ${kind}`;
  if (!ps.color) page.classList.add('ps-mono');
  if (ps.font === 'serif') page.classList.add('ps-serif');
  page.style.setProperty('--fs', `${PS_FONT_MAX}pt`);

  const who = [ps.affiliation, ps.author].filter(Boolean).map(escapeHtml).join('　');
  page.innerHTML = `
    <div class="ps-running"><span>${escapeHtml(psAutoTitle())}</span><span>${who}</span></div>
    <div class="ps-body"></div>
    <div class="ps-footer"><span>${escapeHtml(psPeriodLabel())}</span><span class="ps-pno"></span></div>
  `;
  frame.appendChild(page);
  stage.appendChild(frame);
  return page;
}

function psOverflows(el, tol = 1) {
  return el.scrollHeight > el.clientHeight + tol;
}

function psStampBoxes() {
  if (!ps.stamp) return '';
  return `<div class="ps-stamps"><div class="ps-stamp"><span>確認</span></div><div class="ps-stamp"><span>確認</span></div></div>`;
}


// ===== 図・表 =====
function psAtts(report) {
  if (!ps.figures) return [];
  const list = Array.isArray(report.attachments) ? report.attachments : [];
  return list
    .filter(a => (a.kind === 'image' ? !!safeImageSrc(a.src) : !!(a.tsv || '').trim()))
    .map(a => ({ ...a, label: attLabel(a, list) }));
}

// 印刷位置ごとに仕分ける（載せない項目に紐づくものは末尾へ）
function psAttsBySection(report) {
  const map = {};
  const merged = ps.merge && ps.fields.issues && ps.fields.next;
  psAtts(report).forEach(a => {
    let key = a.section && ps.fields[a.section] ? a.section : '';
    if (merged && (key === 'issues' || key === 'next')) key = 'issues_next';
    (map[key] = map[key] || []).push(a);
  });
  return map;
}

function psAttTableHtml(att) {
  const raw = (att.tsv || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!raw.trim()) return '';
  const rows = raw.split('\n').map(r => r.split('\t'));
  const cell = (v, tag) => {
    const num = v.trim() !== '' && /^[-+]?[\d,]+(\.\d+)?%?$/.test(v.trim());
    return `<${tag}${num ? ' class="ps-num"' : ''}>${psInline(v)}</${tag}>`;
  };
  const head = att.header
    ? `<thead><tr>${rows[0].map(v => cell(v, 'th')).join('')}</tr></thead>`
    : '';
  const bodyRows = att.header ? rows.slice(1) : rows;
  return `<table class="ps-att-table">${head}<tbody>${
    bodyRows.map(r => `<tr>${r.map(v => cell(v, 'td')).join('')}</tr>`).join('')
  }</tbody></table>`;
}

function psFigCaption(att) {
  return `<figcaption class="ps-fig-cap"><b>${escapeHtml(att.label)}</b>${att.caption ? '　' + escapeHtml(att.caption) : ''}</figcaption>`;
}

function psFigEl(att, { height = 40, fill = false } = {}) {
  const fig = document.createElement('figure');
  fig.className = `ps-fig ps-fig-${att.kind}${fill ? ' ps-fig-fill' : ''}`;
  if (!fill) fig.style.setProperty('--fig-h', `${(height * (PS_FIG_SCALE[ps.figSize] || 1)).toFixed(1)}mm`);
  if (att.kind === 'image') {
    fig.style.setProperty('--ar', (att.w / att.h).toFixed(4));
    fig.innerHTML = `<div class="ps-fig-box"><img src="${safeImageSrc(att.src)}" alt=""></div>${psFigCaption(att)}`;
  } else {
    // 表はキャプションを上に置く（日本語の慣例）
    fig.innerHTML = `${psFigCaption(att)}${psAttTableHtml(att)}`;
  }
  return fig;
}

function psFigGroup(atts, opts) {
  const wrap = document.createElement('div');
  wrap.className = 'ps-figs';
  atts.forEach(a => wrap.appendChild(psFigEl(a, opts)));
  return wrap;
}

// 図・表のページ（別表）。1ページに載せる枚数で大きさが決まる
function psRenderFigPages(stage, dateKey, atts, { landscape = false } = {}) {
  const per = PS_FIG_PER_PAGE[ps.figSize] || 2;
  // 縦置きは縦に並べ、横置きは横に並べる
  const cols = landscape ? (per >= 2 ? 2 : 1) : (per >= 4 ? 2 : 1);

  for (let i = 0; i < atts.length; i += per) {
    const chunk = atts.slice(i, i + per);
    // 最後のページが半端な枚数でも、紙の高さを使い切る
    const rows = Math.max(1, Math.ceil(chunk.length / cols));
    const page = psNewPage(stage, { kind: 'ps-kind-figs', landscape });
    const body = page.querySelector('.ps-body');
    const part = atts.length > per ? `（${Math.floor(i / per) + 1}/${Math.ceil(atts.length / per)}）` : '';
    body.innerHTML = `
      <div class="ps-day-head">
        <div>
          <div class="ps-day-date">${psDateLong(dateKey)}</div>
          <div class="ps-day-meta">図・表${part}</div>
        </div>
        ${psStampBoxes()}
      </div>
      <div class="ps-fixed ps-figs-page" style="--cols:${cols};--rows:${rows}"></div>
    `;
    const area = body.querySelector('.ps-figs-page');
    chunk.forEach(a => area.appendChild(psFigEl(a, { fill: true })));

    // 表が大きすぎる場合だけ文字を詰める（画像は枠に合わせて縮む）
    const over = () => psOverflows(area) || [...area.querySelectorAll('.ps-att-table')].some(t => t.scrollWidth > t.parentElement.clientWidth + 1);
    let fs = PS_FONT_MAX;
    while (over() && fs > PS_FONT_MIN) {
      fs = Math.max(PS_FONT_MIN, fs - 0.25);
      page.style.setProperty('--fs', `${fs}pt`);
    }
  }
}

// ===== レイアウトA: 1日1ページ =====
function psRenderDaily(stage, dateKey) {
  const report = state.reports[dateKey] || {};
  const blocks = psBlocks(report);
  const page = psNewPage(stage, { kind: 'ps-kind-daily' });
  const body = page.querySelector('.ps-body');
  const chars = blocks.reduce((a, b) => a + b.text.replace(/\s/g, '').length, 0);
  const filled = filledCount(report);

  body.innerHTML = `
    <div class="ps-day-head">
      <div>
        <div class="ps-day-date">${psDateLong(dateKey)}</div>
        <div class="ps-day-meta">記入 ${filled}/${CORE_FIELDS.length} 項目 ・ ${chars.toLocaleString()} 字</div>
      </div>
      ${psStampBoxes()}
    </div>
    <div class="ps-fixed"></div>
  `;
  const fixed = body.querySelector('.ps-fixed');
  const attMap = psAttsBySection(report);

  const buildSections = (withFigs) => {
    fixed.innerHTML = '';
    blocks.forEach(b => {
      const sec = psSectionShell(b);
      const secBody = sec.querySelector('.ps-sec-body');
      secBody.innerHTML = psLines(b.text).join('');
      if (withFigs && attMap[b.key]) {
        secBody.appendChild(psFigGroup(attMap[b.key], { height: 44 }));
        sec.classList.remove('ps-empty');
      }
      fixed.appendChild(sec);
    });
    if (withFigs && attMap['']) {
      const sec = psSectionShell({ key: 'figs', label: '図・表', color: '#64748B', text: ' ' });
      sec.querySelector('.ps-sec-body').appendChild(psFigGroup(attMap[''], { height: 48 }));
      fixed.appendChild(sec);
    }
    if (ps.comment) {
      const c = psSectionShell({ key: 'comment', label: '指導者コメント', color: '#94A3B8', text: '' });
      c.classList.add('ps-comment');
      fixed.appendChild(c);
    }
  };

  // 文字を小さくし、足りなければ図を少し縮めて1ページに収める
  // 図のために本文を読めない大きさまで詰めないよう、図ありのときは下限を高くする
  const fitPage = ({ fsFloor = PS_FONT_MIN, figFloor = 1 } = {}) => {
    const bodies = [...fixed.querySelectorAll('.ps-sec:not(.ps-empty) .ps-sec-body')];
    const fits = () => !psOverflows(fixed) && bodies.every(b => !psOverflows(b));
    let fs = PS_FONT_MAX;
    page.style.setProperty('--fs', `${fs}pt`);
    fixed.style.removeProperty('--fig-k');
    while (!fits() && fs > fsFloor) {
      fs = Math.max(fsFloor, fs - 0.25);
      page.style.setProperty('--fs', `${fs}pt`);
    }
    let figK = 1;
    while (!fits() && figK > figFloor) {
      figK = Math.max(figFloor, figK - 0.05);
      fixed.style.setProperty('--fig-k', figK.toFixed(2));
    }
    return { ok: fits(), fs };
  };

  const allAtts = psAtts(report);
  const inline = ps.figPlacement === 'inline';
  const hasFigs = inline && Object.keys(attMap).length > 0;

  if (!inline && allAtts.length) {
    // 「別ページに大きく」：本文は本文だけで組み、図は後ろのページへ
    buildSections(false);
    const rp = fitPage();
    if (rp.ok) {
      psRenderFigPages(stage, dateKey, allAtts);
      return { shrunk: rp.fs < PS_FONT_MAX ? rp.fs : null, split: false, figsMoved: false };
    }
    stage.removeChild(page.parentElement);
    psFlowRender(stage, [dateKey], { columns: 1, kind: 'ps-kind-daily', dayPerPage: true });
    return { shrunk: null, split: true, figsMoved: false };
  }

  buildSections(hasFigs);
  let r = fitPage(hasFigs ? { fsFloor: 7.5, figFloor: 0.8 } : {});
  if (r.ok) return { shrunk: r.fs < PS_FONT_MAX ? r.fs : null, split: false, figsMoved: false };

  // 図を入れたままでは収まらない → 図は「図・表」ページへ回す
  if (hasFigs) {
    buildSections(false);
    r = fitPage();
    if (r.ok) {
      psRenderFigPages(stage, dateKey, psAtts(report));
      return { shrunk: r.fs < PS_FONT_MAX ? r.fs : null, split: false, figsMoved: true };
    }
  }

  // 最小サイズでも入らない → この日は続きページ方式で流し込む
  stage.removeChild(page.parentElement);
  psFlowRender(stage, [dateKey], { columns: 1, kind: 'ps-kind-daily', dayPerPage: true });
  return { shrunk: null, split: true, figsMoved: false };
}

// ===== レイアウトB: 流し込み（段組・ページ送り） =====
function psFlowRender(stage, dates, { columns = 2, kind = 'ps-kind-flow', dayPerPage = false } = {}) {
  let page, cols, colIdx;

  const newPage = () => {
    page = psNewPage(stage, { kind });
    page.style.setProperty('--fs', `${columns === 2 ? 8.5 : 9}pt`);
    const body = page.querySelector('.ps-body');
    body.innerHTML = `<div class="ps-cols" style="--cols:${columns}">${'<div class="ps-col"></div>'.repeat(columns)}</div>`;
    cols = [...body.querySelectorAll('.ps-col')];
    colIdx = 0;
  };
  const col = () => cols[colIdx];
  const nextCol = () => {
    if (colIdx < cols.length - 1) colIdx++;
    else newPage();
  };

  // 見出しは直後の数行と一緒に置く（見出しだけ段の最後に残さない）
  const placeKeepWithNext = (el, reserveMm = 14) => {
    const probe = document.createElement('div');
    probe.style.height = `${reserveMm}mm`;
    col().append(el, probe);
    if (psOverflows(col()) && col().children.length > 2) {
      el.remove(); probe.remove();
      nextCol();
      col().append(el);
    } else {
      probe.remove();
    }
  };

  newPage();
  dates.forEach((dateKey, di) => {
    const report = state.reports[dateKey] || {};
    if (dayPerPage && di > 0) newPage();

    const head = document.createElement('div');
    head.className = 'ps-flow-day';
    head.innerHTML = `<span class="ps-flow-date">${psDateLong(dateKey)}</span>${dayPerPage ? psStampBoxes() : ''}`;
    placeKeepWithNext(head, 20);

    const attMap = psAttsBySection(report);

    // 図・表は途中で切れないので、入らなければ次の段へ送る
    const placeFigs = (atts) => {
      if (!atts || ps.figPlacement !== 'inline') return;
      atts.forEach(a => {
        const el = psFigEl(a, { height: columns === 2 ? 40 : 52 });
        col().appendChild(el);
        if (psOverflows(col()) && col().children.length > 1) {
          el.remove();
          nextCol();
          col().appendChild(el);
        }
      });
    };

    const inlineFigs = ps.figPlacement === 'inline';
    psBlocks(report).forEach(block => {
      if (!block.text && !(inlineFigs && attMap[block.key])) return; // 流し込みでは空欄を省く
      if (!block.text) { placeFigs(attMap[block.key]); return; }
      let sec = psSectionShell(block);
      placeKeepWithNext(sec, 10);
      let bodyEl = sec.querySelector('.ps-sec-body');

      psLines(block.text).forEach(html => {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const line = tmp.firstElementChild;
        bodyEl.appendChild(line);
        if (!psOverflows(col())) return;

        line.remove();
        // 【小見出し】だけが段の最後に残らないよう、一緒に次の段へ送る
        const carried = [];
        const lastEl = bodyEl.lastElementChild;
        if (lastEl && bodyEl.children.length > 1 && /^【[^】]*】$/.test(lastEl.textContent.trim())) {
          carried.push(lastEl);
          lastEl.remove();
        }
        const onlyTitle = bodyEl.children.length === 0;
        if (onlyTitle) sec.remove();
        nextCol();
        sec = psSectionShell(block, { cont: !onlyTitle });
        col().appendChild(sec);
        bodyEl = sec.querySelector('.ps-sec-body');
        bodyEl.append(...carried, line); // 空の段でも入らない長さなら、はみ出しを許容
      });

      placeFigs(attMap[block.key]);
    });

    placeFigs(attMap['']);

    if (ps.comment && dayPerPage) {
      const c = psSectionShell({ key: 'comment', label: '指導者コメント', color: '#94A3B8', text: '' });
      c.classList.add('ps-comment', 'ps-comment-flow');
      placeKeepWithNext(c, 30);
    }
  });
}

// ===== レイアウトC: 一覧表（横向き） =====
function psRenderTable(stage, dates) {
  const probeReport = {};
  const rows = psBlocks(probeReport).map(b => ({ key: b.key, label: b.label, color: b.color }));
  let perPage = Math.min(7, dates.length) || 1;

  const build = (chunk, rowStart = 0, lineSkip = 0) => {
    const page = psNewPage(stage, { landscape: true, kind: 'ps-kind-table' });
    const body = page.querySelector('.ps-body');
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    const cells = chunk.map(k => psBlocks(state.reports[k] || {}));
    body.innerHTML = `
      <div class="ps-table-head">
        <div>
          <div class="ps-table-title">${escapeHtml(psAutoTitle())}　一覧${rowStart || lineSkip ? '<span class="ps-cont">（続き）</span>' : ''}</div>
          <div class="ps-day-meta">${psDateShort(first)}${first !== last ? ' 〜 ' + psDateShort(last) : ''}</div>
        </div>
        ${psStampBoxes()}
      </div>
      <div class="ps-fixed ps-table-wrap">
        <table class="ps-table">
          <colgroup><col class="ps-col-label">${chunk.map(() => '<col>').join('')}</colgroup>
          <thead><tr><th></th>${chunk.map(k => `<th>${psDateShort(k)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.slice(rowStart).map((r, i) => `
              <tr style="--c:${r.color}">
                <th class="ps-row-label">${escapeHtml(r.label)}</th>
                ${cells.map(c => `<td>${psLines(c[rowStart + i].text).slice(i === 0 ? lineSkip : 0).join('') || '<span class="ps-dash">—</span>'}</td>`).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
    const wrap = body.querySelector('.ps-table-wrap');
    let fs = 8.5;
    page.style.setProperty('--fs', `${fs}pt`);
    while (psOverflows(wrap) && fs > PS_TABLE_MIN) {
      fs = Math.max(PS_TABLE_MIN, fs - 0.25);
      page.style.setProperty('--fs', `${fs}pt`);
    }
    return { page, wrap, ok: !psOverflows(wrap), fs, shown: rows.length - rowStart };
  };

  // 入らなければ1ページあたりの日数を減らして再試行
  while (perPage > 1) {
    const frames = [];
    let allOk = true;
    let smallest = 99;
    for (let i = 0; i < dates.length; i += perPage) {
      const r = build(dates.slice(i, i + perPage));
      frames.push(r.page.parentElement);
      smallest = Math.min(smallest, r.fs);
      if (!r.ok) { allOk = false; break; }
    }
    if (allOk) return { perPage, fs: smallest };
    frames.forEach(f => f.remove());
    perPage = Math.max(1, Math.ceil(perPage / 2));
  }

  // 1日ずつでも入らない日は、項目（行）単位で続きページへ送る
  let smallest = 99;
  dates.forEach(k => {
    let rowStart = 0;
    let lineSkip = 0;
    let guard = 0;
    while (rowStart < rows.length && guard++ < 200) {
      const r = build([k], rowStart, lineSkip);
      let shown = r.shown;
      smallest = Math.min(smallest, r.fs);
      if (r.ok) { rowStart += shown; lineSkip = 0; continue; }
      const tbody = r.page.querySelector('tbody');
      while (psOverflows(r.wrap) && tbody.children.length > 1) {
        tbody.lastElementChild.remove();
        shown--;
      }
      if (!psOverflows(r.wrap)) { rowStart += shown; lineSkip = 0; continue; }
      // 1項目だけでも入らない → セルの行を途中で切って次ページへ
      const td = tbody.querySelector('td');
      let kept = td.children.length;
      while (psOverflows(r.wrap) && kept > 1) {
        td.lastElementChild.remove();
        kept--;
      }
      const total = psLines(psBlocks(state.reports[k] || {})[rowStart].text).length;
      lineSkip += kept;
      if (lineSkip >= total) { rowStart++; lineSkip = 0; }
    }
  });
  return { perPage: 1, fs: smallest };
}

// ===== 表紙＋サマリー =====
function psRenderCover(stage, dates) {
  const page = psNewPage(stage, { kind: 'ps-kind-cover' });
  const body = page.querySelector('.ps-body');
  const all = dates.map(k => ({ k, r: state.reports[k] || {} }));
  const recorded = all.filter(x => hasContent(x.r));
  const charsOf = r => FIELDS.reduce((a, f) => a + (r[f] || '').replace(/\s/g, '').length, 0);
  const totalChars = recorded.reduce((a, x) => a + charsOf(x.r), 0);
  const maxChars = Math.max(1, ...all.map(x => charsOf(x.r)));
  const lastWithNext = [...recorded].reverse().find(x => (x.r.next || '').trim());
  const lastWithIssues = [...recorded].reverse().find(x => (x.r.issues || '').trim());
  const consults = recorded.filter(x => (x.r.consultation || '').trim());
  const who = [ps.affiliation, ps.author].filter(Boolean).map(escapeHtml).join('<br>');
  const first = s => {
    if (!s || !s.trim()) return '—';
    const line = s.trim().split('\n').map(l => l.trim()).find(Boolean) || '';
    return escapeHtml(line.replace(/^(・|[-*•]\s|\d+[.．)）]\s?)/, ''));
  };
  const periodDays = Math.round((parseISO(ps.to) - parseISO(ps.from)) / 86400000) + 1;

  body.innerHTML = `
    <div class="ps-cover">
      <div class="ps-cover-top">
        <div>
          <div class="ps-cover-kicker">${ {day:'DAILY', week:'WEEKLY', month:'MONTHLY', custom:'ACTIVITY'}[ps.rangeMode] } REPORT</div>
          <h1 class="ps-cover-title">${escapeHtml(psAutoTitle())}</h1>
          <div class="ps-cover-period">${escapeHtml(psPeriodLabel())}</div>
          ${who ? `<div class="ps-cover-who">${who}</div>` : ''}
        </div>
        ${psStampBoxes()}
      </div>

      <div class="ps-kpis">
        <div class="ps-kpi"><b>${recorded.length}</b><span>記録日数（期間 ${periodDays}日）</span></div>
        <div class="ps-kpi"><b>${totalChars.toLocaleString()}</b><span>総文字数</span></div>
        <div class="ps-kpi"><b>${recorded.length ? Math.round(totalChars / recorded.length).toLocaleString() : 0}</b><span>1日あたり平均</span></div>
      </div>

      ${all.length > 1 ? `
      <div class="ps-activity" aria-hidden="true">
        ${all.map(x => {
          const c = charsOf(x.r);
          const d = parseISO(x.k);
          return `<div class="ps-act"><div class="ps-act-bar"><i style="height:${Math.round((c / maxChars) * 100)}%"></i></div><span>${d.getMonth() + 1}/${d.getDate()}</span></div>`;
        }).join('')}
      </div>` : ''}

      <div class="ps-cover-h">日別サマリー</div>
      <table class="ps-sum">
        <thead><tr><th>日付</th><th>目的</th><th>主な成果</th><th>課題</th></tr></thead>
        <tbody>
          ${all.map(x => `<tr><td>${psDateShort(x.k)}</td><td>${first(x.r.objective)}</td><td>${first(x.r.achieved)}</td><td>${first(x.r.issues)}</td></tr>`).join('')}
        </tbody>
      </table>

      <div class="ps-cover-grid">
        <div class="ps-box" style="--c:#A78BFA">
          <div class="ps-box-h">次にやること${lastWithNext ? `<small>${psDateShort(lastWithNext.k)}時点</small>` : ''}</div>
          <div class="ps-box-b">${lastWithNext ? psLines(lastWithNext.r.next.trim()).join('') : '<span class="ps-dash">—</span>'}</div>
        </div>
        <div class="ps-box" style="--c:#FBBF24">
          <div class="ps-box-h">残っている課題${lastWithIssues ? `<small>${psDateShort(lastWithIssues.k)}時点</small>` : ''}</div>
          <div class="ps-box-b">${lastWithIssues ? psLines(lastWithIssues.r.issues.trim()).join('') : '<span class="ps-dash">—</span>'}</div>
        </div>
      </div>

      ${consults.length ? `
      <div class="ps-box ps-box-wide" style="--c:#38BDF8">
        <div class="ps-box-h">相談・連絡事項まとめ</div>
        <div class="ps-box-b">${consults.map(x => `<div class="ps-consult"><span class="ps-consult-d">${psDateShort(x.k)}</span><div>${psLines(x.r.consultation.trim()).join('')}</div></div>`).join('')}</div>
      </div>` : ''}

      ${ps.comment ? `<div class="ps-box ps-box-wide ps-comment-cover" style="--c:#94A3B8"><div class="ps-box-h">指導者コメント</div><div class="ps-box-b ps-ruled"></div></div>` : ''}
    </div>
  `;

  const cover = body.querySelector('.ps-cover');
  let fs = PS_FONT_MAX;
  while (psOverflows(cover) && fs > PS_FONT_MIN) {
    fs = Math.max(PS_FONT_MIN, fs - 0.25);
    page.style.setProperty('--fs', `${fs}pt`);
  }
  // それでも溢れる場合は、長い箱の中身を省略表示にする
  if (psOverflows(cover)) cover.classList.add('ps-clamp');
}

// ===== 描画 =====
let _psRenderSeq = 0;

async function psRender() {
  const seq = ++_psRenderSeq;
  const stage = $('#studio-preview');
  const dates = psDates();
  const notes = [];

  const anyField = Object.values(ps.fields).some(Boolean);
  if (!dates.length || !anyField) {
    stage.innerHTML = `<div class="ps-empty-state">${!anyField ? '載せる項目を1つ以上選んでください' : 'この期間には印刷できる日報がありません。<br>期間を変えるか「未記入の日を省く」をオフにしてください。'}</div>`;
    $('#studio-meta').textContent = '';
    $('#studio-fit').textContent = '';
    $('#ps-print').disabled = true;
    return;
  }
  $('#ps-print').disabled = false;

  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) { /* ignore */ }
  }
  if (seq !== _psRenderSeq) return; // より新しい描画が始まっている
  stage.innerHTML = '';

  const useCover = ps.cover && ps.layout !== 'table' && dates.length > 1;
  if (useCover) psRenderCover(stage, dates);

  if (ps.layout === 'daily') {
    let shrunk = 0, split = 0, figsMoved = 0;
    dates.forEach(k => {
      const r = psRenderDaily(stage, k);
      if (r.shrunk) shrunk++;
      if (r.split) split++;
      if (r.figsMoved) figsMoved++;
    });
    if (shrunk) notes.push(`${shrunk}日分は文字を小さくして1ページに収めました`);
    if (split) notes.push(`${split}日分は長いため続きページに分けました`);
    if (figsMoved) notes.push(`${figsMoved}日分は図・表を別ページにしました`);
  } else if (ps.layout === 'flow') {
    psFlowRender(stage, dates, { columns: 2 });
    if (ps.figPlacement !== 'inline') {
      let figDays = 0;
      dates.forEach(k => {
        const atts = psAtts(state.reports[k] || {});
        if (atts.length) { psRenderFigPages(stage, k, atts); figDays++; }
      });
      if (figDays) notes.push(`図・表は後ろのページにまとめました（${figDays}日分）`);
    }
  } else {
    const r = psRenderTable(stage, dates);
    if (r.perPage < Math.min(7, dates.length)) notes.push(`文字量が多いため1ページ${r.perPage}日に分割しました`);
    if (r.fs && r.fs < 7) notes.push(`文字サイズ ${r.fs}pt`);
    // 一覧表には図が入らないので、図・表は後ろのページにまとめる
    let figDays = 0;
    dates.forEach(k => {
      const atts = psAtts(state.reports[k] || {});
      if (atts.length) {
        psRenderFigPages(stage, k, atts, { landscape: true });
        figDays++;
      }
    });
    if (figDays) notes.push(`図・表は後ろのページにまとめました（${figDays}日分）`);
  }

  // ページ番号
  const pages = [...stage.querySelectorAll('.ps-page')];
  pages.forEach((p, i) => { p.querySelector('.ps-pno').textContent = `${i + 1} / ${pages.length}`; });

  // 実際に溢れている箱がないかを最後に確認する
  const clipped = [...stage.querySelectorAll('.ps-fixed, .ps-col, .ps-fixed .ps-sec:not(.ps-empty) .ps-sec-body')]
    .filter(el => psOverflows(el)).length;
  const clamped = !!stage.querySelector('.ps-clamp');

  $('#studio-meta').textContent = `${dates.length}日分 ・ ${pages.length}ページ`;
  const fit = $('#studio-fit');
  fit.classList.toggle('warn', clipped > 0);
  if (clipped) notes.unshift(`⚠ ${clipped}か所で文字が収まりきっていません。レイアウトを変えてください`);
  if (clamped) notes.push('表紙のまとめ欄は長いため一部を省略しています');
  fit.textContent = notes.length ? `ℹ️ ${notes.join(' ／ ')}` : '✓ すべての文字が切れずに収まっています';
  psFitPreview();
}

function psScheduleRender() {
  clearTimeout(_psRenderTimer);
  _psRenderTimer = setTimeout(psRender, 120);
}

// プレビューの縮尺（レイアウト計算には影響しない）
function psFitPreview() {
  const wrap = $('#studio-preview-wrap');
  const stage = $('#studio-preview');
  if (!wrap || !stage) return;
  const mm = 96 / 25.4;
  const hasLandscape = !!stage.querySelector('.is-landscape');
  const pageW = (hasLandscape ? 297 : 210) * mm;
  const avail = wrap.clientWidth - 32;
  const scale = Math.max(0.2, Math.min(1, avail / pageW));
  stage.style.setProperty('--ps-scale', scale.toFixed(4));
}

// ===== コントロール =====
function psSyncControls() {
  $$('#ps-range-mode button').forEach(b => b.classList.toggle('active', b.dataset.v === ps.rangeMode));
  $$('#ps-layout .layout-card').forEach(b => b.classList.toggle('active', b.dataset.v === ps.layout));
  $('#ps-from').value = ps.from;
  $('#ps-to').value = ps.to;
  $('#ps-merge').checked = ps.merge;
  $('#ps-merge').disabled = !(ps.fields.issues && ps.fields.next);
  $('#ps-cover').checked = ps.cover;
  $('#ps-cover').disabled = ps.layout === 'table';
  $('#ps-skip-empty').checked = ps.skipEmpty;
  $('#ps-comment').checked = ps.comment;
  $('#ps-stamp').checked = ps.stamp;
  $('#ps-color').checked = ps.color;
  $('#ps-figures').checked = ps.figures;
  $('#ps-fig-placement').value = ps.figPlacement;
  $('#ps-fig-placement').disabled = !ps.figures;
  $('#ps-fig-size').value = ps.figSize;
  $('#ps-fig-size').disabled = !ps.figures;
  $('#ps-fig-size-label').textContent = ps.figPlacement === 'inline' ? '図の大きさ' : '1ページに';
  $$('#ps-fig-size option').forEach(o => {
    o.textContent = ps.figPlacement === 'inline'
      ? { small: '小さめ', auto: '標準', large: '大きめ' }[o.value]
      : { small: '4枚ずつ', auto: '2枚ずつ', large: '1枚ずつ（最大）' }[o.value];
  });
  $('#ps-weekends').value = ps.weekends;
  $('#ps-font').value = ps.font;
  $('#ps-title').value = ps.title;
  $('#ps-title').placeholder = `タイトル（空欄なら「${{ day: '日報', week: '週間日報', month: '月間日報', custom: '活動報告' }[ps.rangeMode]}」）`;
  $('#ps-affiliation').value = ps.affiliation;
  $('#ps-author').value = ps.author;
  $$('#ps-fields input').forEach(i => { i.checked = !!ps.fields[i.value]; });
}

function psBuildFieldChecks() {
  $('#ps-fields').innerHTML = SECTIONS.map(s =>
    `<label class="chk chip-chk" style="--c:${s.color}"><input type="checkbox" value="${s.key}" /> ${s.label}</label>`
  ).join('');
}

function psInitControls() {
  psBuildFieldChecks();

  $('#ps-range-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    ps.rangeMode = b.dataset.v;
    if (ps.rangeMode !== 'custom') Object.assign(ps, psRangeFor(ps.rangeMode, ps.from));
    psChanged();
  });
  $('#ps-range-prev').addEventListener('click', () => { psShiftRange(-1); psChanged(); });
  $('#ps-range-next').addEventListener('click', () => { psShiftRange(1); psChanged(); });
  const onDate = () => {
    const f = $('#ps-from').value;
    const t = $('#ps-to').value;
    if (!f || !t) return;
    ps.from = f <= t ? f : t;
    ps.to = f <= t ? t : f;
    ps.rangeMode = ps.from === ps.to ? 'day' : 'custom';
    psChanged();
  };
  $('#ps-from').addEventListener('change', onDate);
  $('#ps-to').addEventListener('change', onDate);

  $('#ps-layout').addEventListener('click', (e) => {
    const b = e.target.closest('.layout-card');
    if (!b) return;
    ps.layout = b.dataset.v;
    psChanged();
  });

  $('#ps-fields').addEventListener('change', (e) => {
    ps.fields[e.target.value] = e.target.checked;
    psChanged();
  });

  const bind = (id, key, prop = 'checked') => {
    $(id).addEventListener(prop === 'checked' ? 'change' : 'input', (e) => {
      ps[key] = e.target[prop];
      psChanged();
    });
  };
  bind('#ps-merge', 'merge');
  bind('#ps-cover', 'cover');
  bind('#ps-skip-empty', 'skipEmpty');
  bind('#ps-comment', 'comment');
  bind('#ps-stamp', 'stamp');
  bind('#ps-color', 'color');
  bind('#ps-figures', 'figures');
  bind('#ps-fig-placement', 'figPlacement', 'value');
  bind('#ps-fig-size', 'figSize', 'value');
  bind('#ps-weekends', 'weekends', 'value');
  bind('#ps-font', 'font', 'value');
  bind('#ps-title', 'title', 'value');
  bind('#ps-affiliation', 'affiliation', 'value');
  bind('#ps-author', 'author', 'value');

  $('#studio-close').addEventListener('click', closePrintStudio);
  $('#print-studio').addEventListener('click', (e) => {
    if (e.target.id === 'print-studio') closePrintStudio();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#print-studio').classList.contains('hidden')) closePrintStudio();
  });
  $('#ps-print').addEventListener('click', printFromStudio);
  $('#ps-copy').addEventListener('click', psCopyText);

  window.addEventListener('resize', () => {
    if (!$('#print-studio').classList.contains('hidden')) psFitPreview();
  });
  window.addEventListener('afterprint', () => {
    $('#print-area').innerHTML = '';
    const st = $('#ps-page-style');
    if (st) st.remove();
  });
}

function psChanged() {
  psSyncControls();
  psPersist();
  psScheduleRender();
}

// ===== 開閉 =====
function openPrintStudio({ mode, anchor } = {}) {
  saveCurrentInputs();
  const base = psSettings();
  ps = { ...base };
  if (mode) ps.rangeMode = mode;
  if (ps.rangeMode === 'custom') ps.rangeMode = 'week';
  Object.assign(ps, psRangeFor(ps.rangeMode, anchor || todayISO()));

  _psReturnFocus = document.activeElement;
  $('#print-studio').classList.remove('hidden');
  document.body.classList.add('studio-open');
  psSyncControls();
  psRender();
  setTimeout(() => $('#studio-close').focus({ preventScroll: true }), 50);
}

function closePrintStudio() {
  $('#print-studio').classList.add('hidden');
  document.body.classList.remove('studio-open');
  $('#studio-preview').innerHTML = '';
  if (_psReturnFocus && _psReturnFocus.focus) _psReturnFocus.focus({ preventScroll: true });
}

async function printFromStudio() {
  const stage = $('#studio-preview');
  clearTimeout(_psRenderTimer);
  await psRender();
  const pages = [...stage.querySelectorAll('.ps-page')];
  if (!pages.length) return;

  const landscape = pages[0].classList.contains('ps-landscape');
  let st = $('#ps-page-style');
  if (!st) {
    st = document.createElement('style');
    st.id = 'ps-page-style';
    document.head.appendChild(st);
  }
  st.textContent = `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 0; }`;

  $('#print-area').innerHTML = pages.map(p => p.outerHTML).join('');
  const prevTitle = document.title;
  // PDF保存時のファイル名になる
  document.title = `${psAutoTitle()}_${ps.from.replace(/-/g, '')}${ps.from !== ps.to ? '-' + ps.to.replace(/-/g, '') : ''}`;
  setTimeout(() => {
    window.print();
    document.title = prevTitle;
  }, 60);
}

// ===== テキストでコピー（Slack・メール貼り付け用） =====
function psPlainText() {
  const dates = psDates();
  const out = [`■ ${psAutoTitle()}　${psPeriodLabel()}`];
  const who = [ps.affiliation, ps.author].filter(Boolean).join(' ');
  if (who) out.push(who);
  dates.forEach(k => {
    const blocks = psBlocks(state.reports[k] || {}).filter(b => b.text);
    if (!blocks.length && !psAtts(state.reports[k] || {}).length) return;
    out.push('', `━━ ${psDateLong(k)} ━━`);
    const attMap = psAttsBySection(state.reports[k] || {});
    blocks.forEach(b => {
      out.push(`【${b.label}】`, b.text.replace(/【(課題点|次回につなげること)】\n/g, '＜$1＞\n'));
      (attMap[b.key] || []).forEach(a => out.push(`［${a.label}${a.caption ? '：' + a.caption : ''}］`));
      out.push('');
    });
    (attMap[''] || []).forEach(a => out.push(`［${a.label}${a.caption ? '：' + a.caption : ''}］`));
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

async function psCopyText() {
  const text = psPlainText();
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  showToast('success', '📋 コピーしました', 'チャットやメールにそのまま貼り付けられます', 2500);
}

document.addEventListener('DOMContentLoaded', psInitControls);
