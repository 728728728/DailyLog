/* ============================================
   DailyLog — 日報管理システム Application Logic
   ============================================ */

// ===== State =====
let state = {
  reports: {},      // { "2026-04-11": { done, achieved, issues, next, updatedAt } }
  selectedDate: null,
  calendarDate: new Date(),
};

// ===== DOM Helpers =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const FIELDS = ['objective', 'done', 'achieved', 'insights', 'issues', 'next', 'references', 'consultation'];
const FIELD_LABELS = {
  objective: '🎯 本日の目的',
  done: '📋 行ったこと',
  achieved: '✅ 出来たこと',
  insights: '💡 考察・気づき',
  issues: '⚠️ 課題点',
  next: '🔮 次回につなげること',
  issues_next: '⚠️ 課題 ＆ 🔮 次回のアクション',
  references: '📚 参照文献・資料',
  consultation: '💬 相談・連絡事項'
};
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

function prevDateISO(dateStr) {
  const d = parseISO(dateStr);
  d.setDate(d.getDate() - 1);
  return formatDateISO(d);
}

// ===== Persistence (ShukatsuHub方式) =====
const STORAGE_KEY = 'daily-log-data';
let _hasUnsavedChanges = false;
let _fileHandle = null; // File System Access API用

// --- localStorage ---
function saveState() {
  try {
    const data = JSON.stringify({ reports: state.reports });
    localStorage.setItem(STORAGE_KEY, data);
  } catch (e) {
    console.error('[DailyLog] localStorage保存エラー:', e);
  }
  _hasUnsavedChanges = true;
  updateSaveIndicator();
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
      if (state.reports[state.selectedDate][field] !== val) {
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
      // localStorageにも書き戻す
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ reports: state.reports }));
      } catch (e) { /* ignore */ }
      console.log('[DailyLog] data.jsバックアップから復元！レポート数:', reportKeys.length);
      showToast('success', '📂 復元完了', 'バックアップファイルからデータを復元しました');
      _hasUnsavedChanges = false;
      return;
    }
  }

  console.log('[DailyLog] データなし。新規開始。');
  state.reports = {};
}

// --- data.jsファイル保存 (ShukatsuHubと同じ) ---
function generateBackupContent() {
  const data = { reports: state.reports, _savedAt: new Date().toISOString() };
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
function updateSaveIndicator() {
  const btn = $('#global-save-btn');
  if (!btn) return;
  const textSpan = btn.querySelector('.save-btn-text');
  if (_hasUnsavedChanges) {
    btn.classList.add('unsaved');
    btn.title = '⚠ 未保存の変更があります！クリックしてファイルに保存';
    if (textSpan) textSpan.textContent = '⚠ 未保存';
  } else {
    btn.classList.remove('unsaved');
    btn.title = 'データをファイルに保存';
    if (textSpan) textSpan.textContent = '保存済み';
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
  const sub = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  $('#header-date-main').textContent = main;
  $('#header-date-sub').textContent = sub;
}

// ===== Stats =====
function renderStats() {
  const totalDays = Object.keys(state.reports).filter(k => hasContent(state.reports[k])).length;
  $('#stat-total').textContent = totalDays;

  // This week (Mon-Sun)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  let thisWeekCount = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = formatDateISO(d);
    if (state.reports[key] && hasContent(state.reports[key])) thisWeekCount++;
  }
  $('#stat-this-week').textContent = thisWeekCount;

  // Streak
  let streak = 0;
  const checkDate = new Date();
  checkDate.setHours(0, 0, 0, 0);
  // Start from today, go backwards
  while (true) {
    const key = formatDateISO(checkDate);
    if (state.reports[key] && hasContent(state.reports[key])) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      // If today has no report yet, check from yesterday
      if (streak === 0 && isSameDay(checkDate, new Date())) {
        checkDate.setDate(checkDate.getDate() - 1);
        continue;
      }
      break;
    }
  }
  $('#stat-streak').textContent = streak;
}

function hasContent(report) {
  if (!report) return false;
  return FIELDS.some(f => report[f] && report[f].trim().length > 0);
}

// ===== Calendar =====
function renderCalendar() {
  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  $('#cal-title').textContent = `${year}年${month + 1}月`;

  // Remove old day cells
  const grid = $('#calendar-grid');
  grid.querySelectorAll('.cal-day').forEach(el => el.remove());

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Previous month days
  for (let i = firstDay - 1; i >= 0; i--) {
    grid.appendChild(createCalDay(daysInPrevMonth - i, true));
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const cellDate = new Date(year, month, d);
    const dateKey = formatDateISO(cellDate);
    const isToday = isSameDay(cellDate, today);
    const isSelected = state.selectedDate === dateKey;
    const hasReport = state.reports[dateKey] && hasContent(state.reports[dateKey]);
    const isFriday = cellDate.getDay() === 5;

    grid.appendChild(createCalDay(d, false, {
      isToday, isSelected, hasReport, isFriday, dateKey
    }));
  }

  // Fill remaining days
  const totalCells = firstDay + daysInMonth;
  const rem = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= rem; d++) {
    grid.appendChild(createCalDay(d, true));
  }
}

function createCalDay(day, isOtherMonth, opts = {}) {
  const cell = document.createElement('div');
  cell.className = 'cal-day';
  cell.textContent = day;

  if (isOtherMonth) {
    cell.classList.add('other-month');
  } else {
    if (opts.isToday) cell.classList.add('today');
    if (opts.isSelected) cell.classList.add('selected');
    if (opts.hasReport) cell.classList.add('has-report');
    if (opts.isFriday) cell.classList.add('friday');

    cell.addEventListener('click', () => {
      // 日付を切り替える前に、現在の入力内容を即保存
      saveCurrentInputs();
      state.selectedDate = opts.dateKey;
      renderCalendar();
      loadReportForDate(opts.dateKey);
      renderPrevDay();
    });
  }

  return cell;
}

// ===== Report Entry =====
function loadReportForDate(dateKey) {
  state.selectedDate = dateKey;
  const date = parseISO(dateKey);
  const dayIdx = date.getDay();

  // Update header
  $('#report-date-text').textContent = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  const daySpan = $('#report-date-day');
  daySpan.textContent = `${DAYS_JP[dayIdx]}曜日`;
  daySpan.className = 'report-date-day';
  if (dayIdx === 0) daySpan.classList.add('sun');
  if (dayIdx === 6) daySpan.classList.add('sat');

  // Load report data
  const report = state.reports[dateKey] || {};
  FIELDS.forEach(field => {
    const textarea = $(`#input-${field}`);
    textarea.value = report[field] || '';
  });
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

  // UIの更新はdebounceで（重い処理なので毎キーストロークは不要）
  clearTimeout(uiUpdateTimeout);
  uiUpdateTimeout = setTimeout(() => {
    renderCalendar();
    renderStats();
  }, 500);
}



// ===== Previous Day Panel =====
function renderPrevDay() {
  const container = $('#prev-day-content');
  if (!state.selectedDate) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📅</div><div class="empty-state-text">日付を選択してください</div></div>';
    return;
  }

  const prevKey = prevDateISO(state.selectedDate);
  const prevDate = parseISO(prevKey);
  const report = state.reports[prevKey];

  let html = `
    <div class="prev-day-header">
      <span>📖</span>
      <span class="prev-day-date">${prevDate.getFullYear()}年${prevDate.getMonth() + 1}月${prevDate.getDate()}日（${DAYS_JP[prevDate.getDay()]}）</span>
    </div>
  `;

  if (!report || !hasContent(report)) {
    html += '<div class="prev-day-empty">前日の日報はまだありません</div>';
    container.innerHTML = html;
    return;
  }

  FIELDS.forEach(field => {
    const content = report[field] || '';
    html += `
      <div class="prev-day-section">
        <div class="prev-day-label" data-section="${field}">${FIELD_LABELS[field]}</div>
        <div class="prev-day-content">${content || '（未記入）'}</div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// ===== Week Selector =====
function renderWeekSelector() {
  const select = $('#week-select');
  select.innerHTML = '';

  // Generate last 8 weeks
  const now = new Date();
  for (let w = 0; w < 8; w++) {
    const refDate = new Date(now);
    refDate.setDate(now.getDate() - (w * 7));

    const { monday, friday } = getWeekRange(refDate);
    const monStr = `${monday.getMonth() + 1}/${monday.getDate()}`;
    const friStr = `${friday.getMonth() + 1}/${friday.getDate()}`;

    const option = document.createElement('option');
    option.value = formatDateISO(monday);
    option.textContent = `${monday.getFullYear()}年 ${monStr}（月）〜 ${friStr}（金）`;
    if (w === 0) option.selected = true;
    select.appendChild(option);
  }
}

function getWeekRange(refDate) {
  const d = new Date(refDate);
  const dayOfWeek = d.getDay();
  // Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((dayOfWeek + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  // Friday
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return { monday, friday };
}

// ===== PDF Export =====
// 印刷用フィールド（参照文献を除外、課題+次回を統合）
const PRINT_FIELDS = ['objective', 'done', 'achieved', 'insights', 'issues_next', 'consultation'];

// セクションごとの色
const SECTION_COLORS = {
  objective: '#2DD4BF', done: '#5BA3E6', achieved: '#34D399', insights: '#818CF8',
  issues: '#FBBF24', next: '#A78BFA', issues_next: '#F59E0B', references: '#FB923C', consultation: '#38BDF8'
};

function exportWeeklyPDF() {
  const mondayStr = $('#week-select').value;
  const monday = parseISO(mondayStr);
  const printArea = $('#print-area');

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const monLabel = `${monday.getFullYear()}年${monday.getMonth() + 1}月${monday.getDate()}日`;
  const friLabel = `${friday.getMonth() + 1}月${friday.getDate()}日`;

  let html = '';

  // ===== 表紙 + 週間サマリー =====
  html += `<div class="print-page print-cover">`;
  html += `<div class="print-cover-top">`;
  html += `<div class="print-cover-line"></div>`;
  html += `<div class="print-cover-title">週 間 日 報</div>`;
  html += `<div class="print-cover-period">${monLabel}（月）〜 ${friLabel}（金）</div>`;
  html += `<div class="print-cover-line"></div>`;
  html += `</div>`;

  // 週間サマリーテーブル
  html += `<div class="print-summary">`;
  html += `<div class="print-summary-title">▶ 週間サマリー</div>`;
  html += `<table class="print-summary-table">`;
  html += `<thead><tr><th>日付</th><th>目的</th><th>主な成果</th><th>課題</th></tr></thead><tbody>`;
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateKey = formatDateISO(d);
    const report = state.reports[dateKey] || {};
    const dayName = `${d.getMonth()+1}/${d.getDate()}（${DAYS_JP[d.getDay()]}）`;
    const obj = truncate(report.objective, 30);
    const ach = truncate(report.achieved, 30);
    const iss = truncate(report.issues, 30);
    html += `<tr><td>${dayName}</td><td>${escapeHtml(obj)}</td><td>${escapeHtml(ach)}</td><td>${escapeHtml(iss)}</td></tr>`;
  }
  html += `</tbody></table></div>`;
  html += `</div>`;

  // ===== 各日のページ（1段・固定レイアウト） =====
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateKey = formatDateISO(d);
    const report = state.reports[dateKey] || {};
    const dayLabel = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${DAYS_JP[d.getDay()]}）`;

    html += `<div class="print-page print-day-page">`;

    // ヘッダー
    html += `<div class="print-day-header">`;
    html += `<div class="print-day-title">日報 — ${dayLabel}</div>`;
    html += `<div class="print-day-week">${monLabel}〜${friLabel} 週</div>`;
    html += `</div>`;

    // 印刷用セクション（参照文献を除外、課題+次回を統合）
    html += `<div class="print-sections">`;
    PRINT_FIELDS.forEach(field => {
      let content = report[field];
      if (field === 'issues_next') {
        const issuesText = report.issues ? report.issues.trim() : '';
        const nextText = report.next ? report.next.trim() : '';
        content = '';
        if (issuesText) content += '【課題点】\n' + issuesText + '\n\n';
        if (nextText) content += '【次回につなげること】\n' + nextText;
        content = content.trim();
      }
      html += buildPrintSection(field, content);
    });
    html += `</div>`;

    html += `</div>`; // end page
  }

  printArea.innerHTML = html;

  setTimeout(() => {
    window.print();
    setTimeout(() => { printArea.innerHTML = ''; }, 1000);
  }, 200);
}

function buildPrintSection(field, content) {
  const text = content && content.trim() ? content.trim() : '';
  const color = SECTION_COLORS[field] || '#999';
  return `
    <div class="print-section" data-section="${field}">
      <div class="print-section-title" style="border-left: 3px solid ${color};">${FIELD_LABELS[field]}</div>
      <div class="print-section-content">${escapeHtml(text)}</div>
    </div>
  `;
}

function truncate(str, maxLen) {
  if (!str || !str.trim()) return '—';
  const firstLine = str.trim().split('\n')[0].replace(/^[・\-\*]\s*/, '');
  return firstLine.length > maxLen ? firstLine.substring(0, maxLen) + '…' : firstLine;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== Friday Banner =====
function checkFridayBanner() {
  const now = new Date();
  const banner = $('#friday-banner');
  if (now.getDay() === 5) {
    banner.classList.remove('hidden');
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

  // Read TodoBlaster state
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

  // Add new goal
  const newGoal = {
    id: generateId(),
    name: name,
    deadline: deadline,
    color: color,
    subtasks: [],
    completedCount: 0,
    createdAt: new Date().toISOString()
  };

  if (!todoState.goals) todoState.goals = [];
  todoState.goals.push(newGoal);

  // Save back
  localStorage.setItem(todoKey, JSON.stringify(todoState));

  // Clear form
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
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
  `;
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

  // Textarea auto-save
  FIELDS.forEach(field => {
    const textarea = $(`#input-${field}`);
    textarea.addEventListener('input', () => {
      onFieldInput(field, textarea.value);
    });
  });

  // PDF export
  $('#btn-export-pdf').addEventListener('click', exportWeeklyPDF);

  // TodoBlaster integration
  $('#btn-integrate').addEventListener('click', integrateWithTodoBlaster);

  // Set min date for integration deadline
  $('#integrate-deadline').min = todayISO();

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+S to save to file
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveToFile();
    }
  });

  // 保存ボタン
  $('#global-save-btn').addEventListener('click', () => {
    saveToFile();
  });
}

// ===== Initialize =====
function init() {
  loadState();

  // Set today as selected date
  state.selectedDate = todayISO();

  // Render everything
  renderHeaderDate();
  renderStats();
  renderCalendar();
  loadReportForDate(state.selectedDate);
  renderPrevDay();
  renderWeekSelector();
  checkFridayBanner();

  // Init event listeners
  initEventListeners();

  // ★ ページ離脱時の保存ガードを初期化
  initPersistenceGuards();

  // Update header time every minute
  setInterval(renderHeaderDate, 60000);

  // Focus on the first textarea for immediate input
  setTimeout(() => {
    $('#input-done').focus();
  }, 300);

  console.log('[DailyLog] 初期化完了。保存済みレポート数:', Object.keys(state.reports).length);
  _hasUnsavedChanges = false;
  updateSaveIndicator();
}

document.addEventListener('DOMContentLoaded', init);
