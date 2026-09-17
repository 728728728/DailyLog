/* ============================================
   DailyLog — 日報管理システム Application Logic
   ============================================ */

// ===== State =====
let state = {
  reports: {},      // { "2026-04-11": { objective, done, ..., updatedAt } }
  settings: {},     // { inputMode, print: {...} }
  selectedDate: null,
  calendarDate: new Date(),
};

// ===== DOM Helpers =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ===== Section Definitions =====
// optional: 空のときは折りたたんで表示する項目
const SECTIONS = [
  {
    key: 'objective', icon: '🎯', label: '本日の目的', color: '#2DD4BF',
    hint: '今日達成したかったこと・仮説',
    question: '今日は何を達成したいですか？',
    placeholder: '例：\n・第3章の初稿を完成させる\n・実験Aの結果を再現できるか確認する\n・仮説：Xの条件ではYが増加するはず',
    starters: ['今日のゴール：', '確認したいこと：', '仮説：'],
  },
  {
    key: 'done', icon: '📋', label: '行ったこと', color: '#5BA3E6',
    hint: '今日取り組んだ作業内容',
    question: '今日、実際に何に取り組みましたか？',
    placeholder: '例：\n・論文の第3章を執筆した\n・実験データの分析を進めた\n・先行研究3本を読んだ',
    starters: ['【午前】', '【午後】', 'ミーティング：', '文献調査：'],
  },
  {
    key: 'achieved', icon: '✅', label: '出来たこと', color: '#34D399',
    hint: '成果・達成できたこと',
    question: '目的に対して、何が形になりましたか？',
    placeholder: '例：\n・第3章の初稿が完成した\n・グラフを3つ作成できた\n・先行研究の要点を整理できた',
    starters: ['完了：', '途中まで：', '数値で言うと、'],
  },
  {
    key: 'insights', icon: '💡', label: '考察・気づき', color: '#818CF8',
    hint: '結果の解釈・想定とのギャップ・新たな発見',
    question: '想定と違ったこと、新しく分かったことは？',
    placeholder: '例：\n・Xの条件ではYが予想に反して減少した → Zの影響が考えられる\n・先行研究AとBの結果に矛盾がある → 実験条件の違いを比較する必要あり',
    starters: ['想定と違ったのは、', 'その理由として考えられるのは、', '次に確かめたいのは、', ' → '],
  },
  {
    key: 'issues', icon: '⚠️', label: '課題点', color: '#FBBF24',
    hint: '問題点・改善すべきこと',
    question: 'うまくいかなかったこと、詰まったことは？',
    placeholder: '例：\n・分析手法の選定に迷っている\n・参考文献が足りない\n・集中力が午後に切れやすい',
    starters: ['詰まった点：', '原因：', '時間がかかった点：'],
  },
  {
    key: 'next', icon: '🔮', label: '次回につなげること', color: '#A78BFA',
    hint: '明日以降のアクションプラン',
    question: '次に取り組むことは何ですか？',
    placeholder: '例：\n・第4章の構成を考える\n・教授に分析手法について相談する\n・午前中に集中作業する時間を確保する',
    starters: ['明日まず、', '優先度高：', '確認する人：'],
  },
  {
    key: 'references', icon: '📚', label: '参照文献・資料', color: '#FB923C', optional: true,
    hint: '今日参照した論文・サイト・書籍',
    question: '今日参照した文献・資料は？',
    placeholder: '例：\n・田中ら (2024) 「XXに関する研究」, ○○学会誌, Vol.12, pp.45-60\n・https://example.com/article — ○○についての解説記事',
    starters: ['論文：', 'URL：', '書籍：'],
  },
  {
    key: 'consultation', icon: '💬', label: '相談・連絡事項', color: '#38BDF8', optional: true,
    hint: '教授・ラボメンバーへの相談メモ',
    question: '誰かに相談・共有したいことは？',
    placeholder: '例：\n・教授に分析手法Aと手法Bのどちらが適切か相談したい\n・次回ゼミで実験結果を報告予定',
    starters: ['先生へ：', '先輩へ：', '共有事項：'],
  },
];

const FIELDS = SECTIONS.map(s => s.key);
const CORE_FIELDS = SECTIONS.filter(s => !s.optional).map(s => s.key);
const SECTION_MAP = Object.fromEntries(SECTIONS.map(s => [s.key, s]));
const FIELD_LABELS = Object.fromEntries(SECTIONS.map(s => [s.key, `${s.icon} ${s.label}`]));
const DAYS_JP = ['日', '月', '火', '水', '木', '金', '土'];

// ===== Utility =====
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function formatDateISO(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function todayISO() {
  return formatDateISO(new Date());
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear()
    && d1.getMonth()    === d2.getMonth()
    && d1.getDate()     === d2.getDate();
}

function parseISO(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDaysISO(dateStr, n) {
  const d = parseISO(dateStr);
  d.setDate(d.getDate() + n);
  return formatDateISO(d);
}

function nowHHMM() {
  const n = new Date();
  return `${n.getHours().toString().padStart(2, '0')}:${n.getMinutes().toString().padStart(2, '0')}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function hasContent(report) {
  if (!report) return false;
  return FIELDS.some(f => report[f] && report[f].trim().length > 0);
}

function filledCount(report, fields = CORE_FIELDS) {
  if (!report) return 0;
  return fields.filter(f => report[f] && report[f].trim()).length;
}

// 指定日より前で、内容のある直近の日報の日付
function findPrevReportDate(dateStr) {
  const keys = Object.keys(state.reports)
    .filter(k => k < dateStr && hasContent(state.reports[k]))
    .sort();
  return keys.length ? keys[keys.length - 1] : null;
}

// ===== Persistence (ShukatsuHub方式) =====
const STORAGE_KEY = 'daily-log-data';
let _hasUnsavedChanges = false;
let _fileHandle = null; // File System Access API用

// --- localStorage ---
function saveState() {
  try {
    const data = JSON.stringify({ reports: state.reports, settings: state.settings });
    localStorage.setItem(STORAGE_KEY, data);
  } catch (e) {
    console.error('[DailyLog] localStorage保存エラー:', e);
  }
  _hasUnsavedChanges = true;
  updateSaveIndicator();
}

// 設定の保存（ファイル未保存扱いにはしない）
function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ reports: state.reports, settings: state.settings }));
  } catch (e) {
    console.error('[DailyLog] 設定保存エラー:', e);
  }
}

// 現在のテキストエリアの値を直接stateに反映して即保存
function saveCurrentInputs() {
  if (!state.selectedDate) return;

  let changed = false;
  FIELDS.forEach(field => {
    const textarea = $(`#input-${field}`);
    if (textarea) {
      const val = textarea.value;
      if (!state.reports[state.selectedDate]) {
        state.reports[state.selectedDate] = {};
      }
      if ((state.reports[state.selectedDate][field] || '') !== val) {
        state.reports[state.selectedDate][field] = val;
        changed = true;
      }
    }
  });

  if (changed) {
    state.reports[state.selectedDate].updatedAt = new Date().toISOString();
    saveState();
  }
}

function loadState() {
  // 1. まずlocalStorageから読む
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state.reports = parsed.reports || {};
      state.settings = parsed.settings || {};
      console.log('[DailyLog] localStorageから読み込み。レポート数:', Object.keys(state.reports).length);
      return;
    } catch (e) {
      console.error('[DailyLog] localStorage解析エラー:', e);
    }
  }

  // 2. localStorageが空/壊れている場合、data.js (SAVED_DATA) から復元
  if (typeof SAVED_DATA !== 'undefined' && SAVED_DATA && SAVED_DATA.reports) {
    const reportKeys = Object.keys(SAVED_DATA.reports);
    if (reportKeys.length > 0) {
      state.reports = SAVED_DATA.reports;
      state.settings = SAVED_DATA.settings || {};
      // localStorageにも書き戻す
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ reports: state.reports, settings: state.settings }));
      } catch (e) { /* ignore */ }
      console.log('[DailyLog] data.jsバックアップから復元！レポート数:', reportKeys.length);
      showToast('success', '📂 復元完了', 'バックアップファイルからデータを復元しました');
      _hasUnsavedChanges = false;
      return;
    }
  }

  console.log('[DailyLog] データなし。新規開始。');
  state.reports = {};
  state.settings = {};
}

// --- data.jsファイル保存 (ShukatsuHubと同じ) ---
function generateBackupContent() {
  const data = { reports: state.reports, settings: state.settings, _savedAt: new Date().toISOString() };
  const lines = [
    '/* =============================================',
    '   DailyLog - Backup Data',
    '   app.jsが起動時にこのデータを読み込みます。',
    '   最終保存: ' + new Date().toLocaleString('ja-JP'),
    '   ============================================= */',
    'const SAVED_DATA = ' + JSON.stringify(data, null, 2) + ';',
    ''
  ];
  return lines.join('\n');
}

async function saveToFile() {
  // まず現在の入力を反映
  saveCurrentInputs();

  const content = generateBackupContent();

  // File System Access API（Chrome/Edge）
  if ('showSaveFilePicker' in window) {
    try {
      if (!_fileHandle) {
        _fileHandle = await window.showSaveFilePicker({
          suggestedName: 'data.js',
          types: [{ description: 'JavaScript', accept: { 'application/javascript': ['.js'] } }],
        });
      }
      const writable = await _fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      _hasUnsavedChanges = false;
      updateSaveIndicator();
      showToast('success', '💾 保存完了', 'データをファイルに保存しました');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('[DailyLog] File System API error:', err);
    }
  }

  // フォールバック: ダウンロード
  const blob = new Blob([content], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'data.js';
  a.click();
  URL.revokeObjectURL(url);
  _hasUnsavedChanges = false;
  updateSaveIndicator();
  showToast('success', '📥 ダウンロード', 'data.jsをDailyLogフォルダに上書き保存してください');
}

// --- 保存インジケーター ---
let _lastAutoSave = null;

function updateSaveIndicator() {
  const btn = $('#global-save-btn');
  if (btn) {
    const textSpan = btn.querySelector('.save-btn-text');
    if (_hasUnsavedChanges) {
      btn.classList.add('unsaved');
      btn.title = '⚠ 未保存の変更があります！クリックしてファイルに保存 (Ctrl+S)';
      if (textSpan) textSpan.textContent = '⚠ 未保存';
    } else {
      btn.classList.remove('unsaved');
      btn.title = 'データをファイルに保存 (Ctrl+S)';
      if (textSpan) textSpan.textContent = '保存済み';
    }
  }

  const ind = $('#save-indicator');
  if (ind && _hasUnsavedChanges) {
    _lastAutoSave = nowHHMM();
    ind.textContent = `✓ ブラウザに自動保存 ${_lastAutoSave}`;
    ind.classList.add('visible');
  }
}

// --- ページ離脱時 ---
function initPersistenceGuards() {
  // ページを閉じる前に: localStorageには保存 + 未保存警告
  window.addEventListener('beforeunload', (e) => {
    saveCurrentInputs();
    if (_hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = '未保存の変更があります。ファイルに保存せずに閉じますか？';
    }
  });

  window.addEventListener('pagehide', () => {
    saveCurrentInputs();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveCurrentInputs();
    }
  });

  window.addEventListener('blur', () => {
    saveCurrentInputs();
  });

  // 30秒ごとにlocalStorageに自動保存
  setInterval(() => {
    saveCurrentInputs();
  }, 30000);
}

// ===== Header Date =====
function renderHeaderDate() {
  const now = new Date();
  const main = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${DAYS_JP[now.getDay()]}）`;
  $('#header-date-main').textContent = main;
  $('#header-date-sub').textContent = nowHHMM();
}

// ===== Stats =====
function renderStats() {
  const totalDays = Object.keys(state.reports).filter(k => hasContent(state.reports[k])).length;
  $('#stat-total').textContent = totalDays;

  // This week (Mon-Sun)
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  let thisWeekCount = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    if (hasContent(state.reports[formatDateISO(d)])) thisWeekCount++;
  }
  $('#stat-this-week').textContent = thisWeekCount;

  // Streak（今日が未記入なら昨日から数える）
  let streak = 0;
  const checkDate = new Date();
  checkDate.setHours(0, 0, 0, 0);
  if (!hasContent(state.reports[formatDateISO(checkDate)])) {
    checkDate.setDate(checkDate.getDate() - 1);
  }
  while (hasContent(state.reports[formatDateISO(checkDate)])) {
    streak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }
  $('#stat-streak').textContent = streak;
}

// ===== Calendar =====
function renderCalendar() {
  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  $('#cal-title').textContent = `${year}年${month + 1}月`;

  const grid = $('#calendar-grid');
  grid.querySelectorAll('.cal-day').forEach(el => el.remove());

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = firstDay - 1; i >= 0; i--) {
    grid.appendChild(createCalDay(daysInPrevMonth - i, true));
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cellDate = new Date(year, month, d);
    const dateKey = formatDateISO(cellDate);
    const report = state.reports[dateKey];
    const filled = hasContent(report) ? filledCount(report) : 0;
    grid.appendChild(createCalDay(d, false, {
      isToday: isSameDay(cellDate, today),
      isSelected: state.selectedDate === dateKey,
      level: filled === 0 ? (hasContent(report) ? 1 : 0) : filled <= 2 ? 1 : filled <= 4 ? 2 : 3,
      filled,
      dow: cellDate.getDay(),
      dateKey,
    }));
  }

  const rem = (7 - ((firstDay + daysInMonth) % 7)) % 7;
  for (let d = 1; d <= rem; d++) {
    grid.appendChild(createCalDay(d, true));
  }
}

function createCalDay(day, isOtherMonth, opts = {}) {
  const cell = document.createElement(isOtherMonth ? 'div' : 'button');
  cell.className = 'cal-day';
  cell.textContent = day;

  if (isOtherMonth) {
    cell.classList.add('other-month');
  } else {
    cell.type = 'button';
    if (opts.isToday) cell.classList.add('today');
    if (opts.isSelected) cell.classList.add('selected');
    if (opts.level) cell.classList.add('has-report', `lv${opts.level}`);
    if (opts.dow === 0) cell.classList.add('sun');
    if (opts.dow === 6) cell.classList.add('sat');
    cell.title = opts.level ? `記入 ${opts.filled}/${CORE_FIELDS.length}` : '未記入';
    cell.addEventListener('click', () => selectDate(opts.dateKey));
  }

  return cell;
}

// ===== Date Selection =====
function selectDate(dateKey, { focus = false } = {}) {
  // 日付を切り替える前に、現在の入力内容を即保存
  saveCurrentInputs();
  state.selectedDate = dateKey;
  const d = parseISO(dateKey);
  if (d.getFullYear() !== state.calendarDate.getFullYear() || d.getMonth() !== state.calendarDate.getMonth()) {
    state.calendarDate = new Date(d.getFullYear(), d.getMonth(), 1);
  }
  renderCalendar();
  loadReportForDate(dateKey);
  renderPrevDay();
  if (focus) focusSection(guideIndex);
}

// ===== Report Entry: build sections =====
function buildSections() {
  const container = $('#report-sections');
  container.innerHTML = '';

  SECTIONS.forEach((s, idx) => {
    const sec = document.createElement('div');
    sec.className = 'report-section';
    sec.dataset.section = s.key;
    sec.dataset.index = idx;
    sec.style.setProperty('--sec-color', s.color);
    if (s.optional) sec.classList.add('optional');

    sec.innerHTML = `
      <div class="report-section-header">
        <span class="report-section-icon">${s.icon}</span>
        <label class="report-section-label" for="input-${s.key}">${s.label}</label>
        <span class="report-section-hint">${s.hint}</span>
        <span class="report-section-count" id="count-${s.key}"></span>
        ${s.optional ? `<button class="section-collapse" data-collapse="${s.key}" title="閉じる" aria-label="${s.label}を閉じる">－</button>` : ''}
      </div>
      <div class="guide-question">${s.question}</div>
      <textarea class="report-textarea" id="input-${s.key}" data-field="${s.key}" rows="3"></textarea>
      <div class="starter-bar" aria-label="書き出しのヒント">
        <button type="button" class="starter" data-insert="bullet">・ 箇条書き</button>
        <button type="button" class="starter" data-insert="time">🕒 時刻</button>
        ${s.starters.map(t => `<button type="button" class="starter" data-insert="text" data-text="${escapeHtml(t)}">${escapeHtml(t.trim())}</button>`).join('')}
      </div>
    `;
    sec.querySelector('textarea').placeholder = s.placeholder;
    container.appendChild(sec);
  });

  // quick log target
  const sel = $('#quick-log-field');
  sel.innerHTML = SECTIONS.map(s => `<option value="${s.key}">${s.icon} ${s.label}</option>`).join('');
  sel.value = 'done';
}

// 任意項目：空なら折りたたみ、「＋ 追加」ボタンを出す
const _openedOptional = new Set();

function applyOptionalVisibility() {
  const report = state.reports[state.selectedDate] || {};
  const row = $('#optional-row');
  row.innerHTML = '';
  SECTIONS.filter(s => s.optional).forEach(s => {
    const sec = $(`.report-section[data-section="${s.key}"]`);
    const has = !!(report[s.key] && report[s.key].trim());
    const open = has || _openedOptional.has(s.key);
    sec.classList.toggle('collapsed', !open);
    if (!open) {
      const b = document.createElement('button');
      b.className = 'optional-add';
      b.type = 'button';
      b.textContent = `＋ ${s.icon} ${s.label}を書く`;
      b.addEventListener('click', () => {
        _openedOptional.add(s.key);
        applyOptionalVisibility();
        const ta = $(`#input-${s.key}`);
        autoGrow(ta);
        ta.focus();
      });
      row.appendChild(b);
    }
  });
}

function loadReportForDate(dateKey) {
  state.selectedDate = dateKey;
  const date = parseISO(dateKey);
  const dayIdx = date.getDay();

  $('#report-date-text').textContent = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  const daySpan = $('#report-date-day');
  daySpan.textContent = `${DAYS_JP[dayIdx]}曜日`;
  daySpan.className = 'report-date-day';
  if (dayIdx === 0) daySpan.classList.add('sun');
  if (dayIdx === 6) daySpan.classList.add('sat');
  const isToday = dateKey === todayISO();
  $('#day-today').classList.toggle('is-today', isToday);

  const report = state.reports[dateKey] || {};
  _openedOptional.clear();
  FIELDS.forEach(field => {
    const textarea = $(`#input-${field}`);
    textarea.value = report[field] || '';
  });
  applyOptionalVisibility();
  FIELDS.forEach(field => autoGrow($(`#input-${field}`)));
  updateProgress();
  renderCarryBanner();

  const ind = $('#save-indicator');
  if (report.updatedAt) {
    const u = new Date(report.updatedAt);
    ind.textContent = `最終更新 ${u.getMonth() + 1}/${u.getDate()} ${u.getHours().toString().padStart(2, '0')}:${u.getMinutes().toString().padStart(2, '0')}`;
    ind.classList.add('visible');
  } else {
    ind.textContent = '';
    ind.classList.remove('visible');
  }
}

function updateProgress() {
  const report = state.reports[state.selectedDate] || {};
  const n = filledCount(report);
  const total = CORE_FIELDS.length;
  $('#progress-fill').style.width = `${(n / total) * 100}%`;
  $('#progress-text').textContent = `${n} / ${total}`;
  $('#progress-fill').classList.toggle('complete', n === total);

  FIELDS.forEach(f => {
    const v = (report[f] || '').trim();
    const sec = $(`.report-section[data-section="${f}"]`);
    sec.classList.toggle('filled', !!v);
    $(`#count-${f}`).textContent = v ? `${v.replace(/\s/g, '').length}字` : '';
  });
  updateGuideSteps();
}

// Debounced UI update (保存ではなくUI更新のみdebounce)
let uiUpdateTimeout = null;

function onFieldInput(field, value) {
  if (!state.selectedDate) return;

  if (!state.reports[state.selectedDate]) {
    state.reports[state.selectedDate] = {};
  }
  state.reports[state.selectedDate][field] = value;
  state.reports[state.selectedDate].updatedAt = new Date().toISOString();

  // ★ 即時保存: 入力のたびにlocalStorageに書き込む
  saveState();

  clearTimeout(uiUpdateTimeout);
  uiUpdateTimeout = setTimeout(() => {
    renderCalendar();
    renderStats();
    updateProgress();
  }, 400);
}

// ===== Textarea helpers =====
function autoGrow(ta) {
  if (!ta || !ta.offsetParent) return;
  const minH = document.body.classList.contains('guide-mode') ? 260 : 96;
  ta.style.height = 'auto';
  ta.style.height = Math.max(minH, ta.scrollHeight + 2) + 'px';
}

// Undo履歴を残して挿入する
function insertText(ta, text) {
  ta.focus();
  const hasSel = ta.selectionStart !== ta.selectionEnd;
  let ok = false;
  if (document.execCommand) {
    // 空文字の insertText は何もしないので、選択範囲の削除は delete で行う
    ok = text === ''
      ? (hasSel ? document.execCommand('delete') : true)
      : document.execCommand('insertText', false, text);
  }
  if (!ok) {
    const { selectionStart: s, selectionEnd: e } = ta;
    ta.setRangeText(text, s, e, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function currentLineInfo(ta) {
  const pos = ta.selectionStart;
  const v = ta.value;
  const start = v.lastIndexOf('\n', pos - 1) + 1;
  let end = v.indexOf('\n', pos);
  if (end === -1) end = v.length;
  return { start, end, line: v.slice(start, end), before: v.slice(start, pos) };
}

const BULLET_RE = /^(\s*)(・|[-*•] |(\d+)([.．)）]) ?)(.*)$/;

function handleSmartEnter(e) {
  const ta = e.target;
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.isComposing || e.keyCode === 229) return; // IME変換中は触らない
  if (ta.selectionStart !== ta.selectionEnd) return;

  const { start, end, line, before } = currentLineInfo(ta);
  const m = line.match(BULLET_RE);
  if (!m || before.length < m[1].length + m[2].length) return;

  e.preventDefault();
  const [, indent, marker, num, sep, rest] = m;
  if (!rest.trim() && ta.selectionStart === end) {
    // 空の箇条書きでEnter → 記号を消して箇条書き終了
    ta.setSelectionRange(start, end);
    insertText(ta, indent);
    return;
  }
  const nextMarker = num ? `${Number(num) + 1}${sep}${marker.endsWith(' ') ? ' ' : ''}` : marker;
  insertText(ta, '\n' + indent + nextMarker);
}

function insertStarter(ta, kind, text) {
  const { before } = currentLineInfo(ta);
  const lineHasText = before.trim().length > 0;
  if (kind === 'bullet') {
    insertText(ta, (lineHasText ? '\n' : '') + '・');
  } else if (kind === 'time') {
    insertText(ta, `${lineHasText ? ' ' : ''}${nowHHMM()} `);
  } else {
    const needsBreak = lineHasText && !text.startsWith(' ');
    insertText(ta, (needsBreak ? '\n' : '') + text);
  }
}

// ===== Quick log =====
function addQuickLog() {
  const input = $('#quick-log-input');
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  const field = $('#quick-log-field').value;
  const ta = $(`#input-${field}`);
  const cur = ta.value.replace(/\s+$/, '');
  const line = `・${nowHHMM()} ${text}`;
  ta.value = cur ? `${cur}\n${line}` : line;
  onFieldInput(field, ta.value);
  if (SECTION_MAP[field].optional) {
    _openedOptional.add(field);
    applyOptionalVisibility();
  }
  autoGrow(ta);
  updateProgress();
  input.value = '';
  flashSection(field);
}

function flashSection(field) {
  const sec = $(`.report-section[data-section="${field}"]`);
  sec.classList.remove('flash');
  void sec.offsetWidth;
  sec.classList.add('flash');
}

// ===== Carry-over (前回の「次回」→ 今日の「目的」) =====
const _dismissedCarry = new Set();

function renderCarryBanner() {
  const banner = $('#carry-banner');
  const prevKey = findPrevReportDate(state.selectedDate);
  const prev = prevKey && state.reports[prevKey];
  const cur = state.reports[state.selectedDate] || {};
  const nextText = prev && prev.next ? prev.next.trim() : '';
  // 目的がまだ空のときだけ提案する（書き始めたら邪魔しない）
  const objectiveWritten = !!(cur.objective || '').trim();

  if (!nextText || objectiveWritten || _dismissedCarry.has(state.selectedDate)) {
    banner.classList.add('hidden');
    return;
  }
  const d = parseISO(prevKey);
  $('#carry-date').textContent = `${d.getMonth() + 1}/${d.getDate()}（${DAYS_JP[d.getDay()]}）`;
  $('#carry-preview').textContent = nextText;
  banner.classList.remove('hidden');
}

function carryInto(field, text, sourceLabel) {
  const ta = $(`#input-${field}`);
  const cur = ta.value.replace(/\s+$/, '');
  ta.value = cur ? `${cur}\n${text}` : text;
  onFieldInput(field, ta.value);
  if (SECTION_MAP[field].optional) _openedOptional.add(field);
  applyOptionalVisibility();
  autoGrow(ta);
  updateProgress();
  flashSection(field);
  renderCarryBanner();
  showToast('success', '↩ 取り込みました', `${sourceLabel}を「${SECTION_MAP[field].label}」に追加しました`, 2500);
}

// ===== Guide Mode =====
let guideIndex = 0;

function setInputMode(mode, { focus = true } = {}) {
  const guide = mode === 'guide';
  document.body.classList.toggle('guide-mode', guide);
  $$('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('#guide-nav').classList.toggle('hidden', !guide);
  $('#guide-footer').classList.toggle('hidden', !guide);
  if (state.settings.inputMode !== mode) {
    state.settings.inputMode = mode;
    saveSettings();
  }
  if (guide) {
    // 最初の未記入項目から始める
    const report = state.reports[state.selectedDate] || {};
    const firstEmpty = CORE_FIELDS.findIndex(f => !(report[f] || '').trim());
    showGuideStep(firstEmpty === -1 ? 0 : firstEmpty, { focus });
  } else {
    $$('.report-section').forEach(s => s.classList.remove('guide-active'));
    FIELDS.forEach(f => autoGrow($(`#input-${f}`)));
  }
}

function showGuideStep(i, { focus = true } = {}) {
  guideIndex = Math.max(0, Math.min(SECTIONS.length - 1, i));
  $$('.report-section').forEach(s => s.classList.toggle('guide-active', Number(s.dataset.index) === guideIndex));
  const s = SECTIONS[guideIndex];
  if (s.optional) _openedOptional.add(s.key);
  $('#guide-count').textContent = `${guideIndex + 1} / ${SECTIONS.length}`;
  $('#guide-prev').disabled = guideIndex === 0;
  $('#guide-next').textContent = guideIndex === SECTIONS.length - 1 ? '完了 ✓' : '次へ →';
  updateGuideSteps();
  const ta = $(`#input-${s.key}`);
  autoGrow(ta);
  if (!focus) return;
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(ta.value.length, ta.value.length);
  const nav = $('#guide-nav');
  const top = nav.getBoundingClientRect().top;
  if (top < 0 || top > window.innerHeight * 0.6) nav.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function updateGuideSteps() {
  const wrap = $('#guide-steps');
  if (!wrap) return;
  const report = state.reports[state.selectedDate] || {};
  wrap.innerHTML = SECTIONS.map((s, i) => {
    const filled = (report[s.key] || '').trim() ? ' filled' : '';
    const active = i === guideIndex ? ' active' : '';
    return `<button type="button" class="guide-step${filled}${active}" data-step="${i}" title="${s.label}" style="--sec-color:${s.color}"><span>${s.icon}</span><em>${s.label}</em></button>`;
  }).join('');
}

function guideNext() {
  if (guideIndex >= SECTIONS.length - 1) {
    setInputMode('list');
    showToast('success', '📝 お疲れさまでした', '今日の日報を書き終えました', 2500);
    return;
  }
  showGuideStep(guideIndex + 1);
}

function focusSection(i) {
  if (document.body.classList.contains('guide-mode')) { showGuideStep(i); return; }
  const secs = [...$$('.report-section:not(.collapsed)')];
  if (!secs.length) return;
  const idx = Math.max(0, Math.min(secs.length - 1, i));
  const ta = secs[idx].querySelector('textarea');
  ta.focus();
  secs[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function moveSectionFocus(delta) {
  const active = document.activeElement;
  if (document.body.classList.contains('guide-mode')) {
    showGuideStep(guideIndex + delta);
    return;
  }
  const secs = [...$$('.report-section:not(.collapsed)')];
  const cur = secs.findIndex(s => s.contains(active));
  focusSection(cur === -1 ? 0 : cur + delta);
}

// ===== Previous Report Panel =====
const CARRY_TARGET = { next: 'objective' };

function renderPrevDay() {
  const container = $('#prev-day-content');
  if (!state.selectedDate) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📅</div><div class="empty-state-text">日付を選択してください</div></div>';
    return;
  }

  const prevKey = findPrevReportDate(state.selectedDate);
  if (!prevKey) {
    container.innerHTML = '<div class="prev-day-empty">これより前の日報はまだありません</div>';
    return;
  }

  const prevDate = parseISO(prevKey);
  const report = state.reports[prevKey];
  const gap = Math.round((parseISO(state.selectedDate) - prevDate) / 86400000);
  const gapLabel = gap === 1 ? '前日' : `${gap}日前`;

  let html = `
    <div class="prev-day-header">
      <button type="button" class="prev-day-date" data-goto="${prevKey}" title="この日を開く">
        ${prevDate.getFullYear()}年${prevDate.getMonth() + 1}月${prevDate.getDate()}日（${DAYS_JP[prevDate.getDay()]}）
      </button>
      <span class="prev-day-gap">${gapLabel}</span>
    </div>
  `;

  SECTIONS.forEach(s => {
    const content = (report[s.key] || '').trim();
    if (!content) return;
    const target = CARRY_TARGET[s.key] || s.key;
    const btnLabel = target === s.key ? '今日へ転記' : `「${SECTION_MAP[target].label}」へ`;
    html += `
      <div class="prev-day-section">
        <div class="prev-day-label" style="--sec-color:${s.color}">
          <span>${s.icon} ${s.label}</span>
          <button type="button" class="prev-carry" data-carry="${s.key}" data-target="${target}">↩ ${btnLabel}</button>
        </div>
        <div class="prev-day-content" style="--sec-color:${s.color}">${escapeHtml(content)}</div>
      </div>
    `;
  });

  container.innerHTML = html;
  container.dataset.prevKey = prevKey;
}

// ===== Friday Banner =====
function checkFridayBanner() {
  if (new Date().getDay() === 5) {
    $('#friday-banner').classList.remove('hidden');
  }
}

// ===== TodoBlaster Integration =====
function integrateWithTodoBlaster() {
  const name = $('#integrate-task-name').value.trim();
  const deadline = $('#integrate-deadline').value;
  const color = $('#integrate-color').value;

  if (!name) {
    showToast('warning', '⚠️ 入力不足', 'タスク名を入力してください');
    return;
  }
  if (!deadline) {
    showToast('warning', '⚠️ 入力不足', '期日を入力してください');
    return;
  }

  const todoKey = 'yare-todo-state-v2';
  let todoState = { goals: [], streak: 0, lastActiveDate: null, notifiedTasks: {}, dailyChecks: {} };
  const saved = localStorage.getItem(todoKey);
  if (saved) {
    try {
      todoState = JSON.parse(saved);
    } catch (e) {
      console.warn('TodoBlaster state parse error', e);
    }
  }

  if (!todoState.goals) todoState.goals = [];
  todoState.goals.push({
    id: generateId(),
    name: name,
    deadline: deadline,
    color: color,
    subtasks: [],
    completedCount: 0,
    createdAt: new Date().toISOString()
  });

  localStorage.setItem(todoKey, JSON.stringify(todoState));

  $('#integrate-task-name').value = '';
  $('#integrate-deadline').value = '';

  showToast('success', '🔗 連携成功！', `「${name}」をTodoBlasterに追加しました`);
}

// ===== Toast =====
function showToast(type, title, message, duration = 4000) {
  const icons = { success: '✅', warning: '⚠️', error: '❌' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || '📢'}</span>
    <div class="toast-body">
      <div class="toast-title"></div>
      <div class="toast-message"></div>
    </div>
    <button class="toast-close" aria-label="閉じる">✕</button>
  `;
  toast.querySelector('.toast-title').textContent = title;
  toast.querySelector('.toast-message').textContent = message;
  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
  $('#toast-container').appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toast-out 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ===== Event Listeners =====
function initEventListeners() {
  // Calendar navigation
  $('#cal-prev').addEventListener('click', () => {
    state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);
    renderCalendar();
  });
  $('#cal-next').addEventListener('click', () => {
    state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);
    renderCalendar();
  });

  // Day navigation
  $('#day-prev').addEventListener('click', () => selectDate(addDaysISO(state.selectedDate, -1)));
  $('#day-next').addEventListener('click', () => selectDate(addDaysISO(state.selectedDate, 1)));
  $('#day-today').addEventListener('click', () => selectDate(todayISO()));

  // Sections (event delegation)
  const sections = $('#report-sections');
  sections.addEventListener('input', (e) => {
    const ta = e.target.closest('textarea[data-field]');
    if (!ta) return;
    onFieldInput(ta.dataset.field, ta.value);
    autoGrow(ta);
  });
  sections.addEventListener('keydown', (e) => {
    if (e.target.matches('textarea[data-field]')) handleSmartEnter(e);
  });
  sections.addEventListener('focusin', (e) => {
    const sec = e.target.closest('.report-section');
    if (sec && !document.body.classList.contains('guide-mode')) {
      guideIndex = Number(sec.dataset.index);
    }
  });
  // mousedownでフォーカスを奪わないようにする（カーソル位置を保つ）
  sections.addEventListener('mousedown', (e) => {
    if (e.target.closest('.starter')) e.preventDefault();
  });
  sections.addEventListener('click', (e) => {
    const starter = e.target.closest('.starter');
    if (starter) {
      const ta = starter.closest('.report-section').querySelector('textarea');
      insertStarter(ta, starter.dataset.insert, starter.dataset.text || '');
      return;
    }
    const collapse = e.target.closest('[data-collapse]');
    if (collapse) {
      const key = collapse.dataset.collapse;
      if ($(`#input-${key}`).value.trim()) {
        showToast('warning', '閉じられません', '内容が入っている項目は閉じられません', 2500);
        return;
      }
      _openedOptional.delete(key);
      applyOptionalVisibility();
    }
  });

  // Mode switch
  $$('.mode-btn').forEach(b => b.addEventListener('click', () => setInputMode(b.dataset.mode)));
  $('#guide-steps').addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) showGuideStep(Number(step.dataset.step));
  });
  $('#guide-prev').addEventListener('click', () => showGuideStep(guideIndex - 1));
  $('#guide-next').addEventListener('click', guideNext);

  $('#btn-shortcuts').addEventListener('click', () => $('#shortcut-help').classList.toggle('hidden'));

  // Quick log
  $('#quick-log-add').addEventListener('click', addQuickLog);
  $('#quick-log-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      addQuickLog();
    }
  });

  // Carry-over
  $('#btn-carry').addEventListener('click', () => {
    const prevKey = findPrevReportDate(state.selectedDate);
    const text = prevKey ? (state.reports[prevKey].next || '').trim() : '';
    if (!text) return;
    carryInto('objective', text, '前回の「次回につなげること」');
  });
  $('#carry-dismiss').addEventListener('click', () => {
    _dismissedCarry.add(state.selectedDate);
    renderCarryBanner();
  });
  $('#prev-day-content').addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) { selectDate(go.dataset.goto); return; }
    const btn = e.target.closest('[data-carry]');
    if (!btn) return;
    const prevKey = $('#prev-day-content').dataset.prevKey;
    const src = btn.dataset.carry;
    const text = (state.reports[prevKey][src] || '').trim();
    if (text) carryInto(btn.dataset.target, text, `前回の「${SECTION_MAP[src].label}」`);
  });

  // Print studio launchers
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-studio]');
    if (!b) return;
    const kind = b.dataset.studio;
    if (kind === 'day') openPrintStudio({ mode: 'day', anchor: state.selectedDate });
    else if (kind === 'prev-week') openPrintStudio({ mode: 'week', anchor: addDaysISO(todayISO(), -7) });
    else if (kind === 'month') openPrintStudio({ mode: 'month', anchor: state.selectedDate });
    else openPrintStudio({ mode: 'week', anchor: state.selectedDate });
  });
  $('#btn-open-studio').addEventListener('click', () => openPrintStudio({ anchor: state.selectedDate }));

  // TodoBlaster integration
  $('#btn-integrate').addEventListener('click', integrateWithTodoBlaster);
  $('#integrate-deadline').min = todayISO();

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const studioOpen = !$('#print-studio').classList.contains('hidden');
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 's') {
      e.preventDefault();
      saveToFile();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'p') {
      e.preventDefault();
      if (studioOpen) printFromStudio();
      else openPrintStudio({ anchor: state.selectedDate });
      return;
    }
    if (studioOpen) return;

    if (e.altKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      selectDate(addDaysISO(state.selectedDate, e.key === 'ArrowLeft' ? -1 : 1));
      return;
    }
    if (e.altKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveSectionFocus(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && e.target.matches('textarea[data-field]')) {
      e.preventDefault();
      if (document.body.classList.contains('guide-mode')) guideNext();
      else moveSectionFocus(1);
    }
  });

  // 保存ボタン
  $('#global-save-btn').addEventListener('click', () => {
    saveToFile();
  });

  window.addEventListener('resize', () => {
    clearTimeout(window._growTimer);
    window._growTimer = setTimeout(() => FIELDS.forEach(f => autoGrow($(`#input-${f}`))), 150);
  });
}

// ===== Initialize =====
function init() {
  loadState();
  buildSections();

  state.selectedDate = todayISO();

  renderHeaderDate();
  renderStats();
  renderCalendar();
  loadReportForDate(state.selectedDate);
  renderPrevDay();
  checkFridayBanner();

  initEventListeners();
  initPersistenceGuards();

  const isDesktop = window.matchMedia('(min-width: 801px)').matches;
  if (state.settings.inputMode === 'guide') setInputMode('guide', { focus: isDesktop });

  setInterval(renderHeaderDate, 60000);

  // PCでは最初の未記入欄にフォーカス（スマホではキーボードが勝手に開かないように）
  if (isDesktop && !document.body.classList.contains('guide-mode')) {
    setTimeout(() => {
      const report = state.reports[state.selectedDate] || {};
      const f = CORE_FIELDS.find(k => !(report[k] || '').trim()) || 'done';
      $(`#input-${f}`).focus({ preventScroll: true });
    }, 300);
  }

  console.log('[DailyLog] 初期化完了。保存済みレポート数:', Object.keys(state.reports).length);
  _hasUnsavedChanges = false;
  updateSaveIndicator();
  $('#save-indicator').classList.toggle('visible', !!$('#save-indicator').textContent);
}

document.addEventListener('DOMContentLoaded', init);
