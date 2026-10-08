/* ============================================
   DailyLog — 図・表（添付）
   画像は取り込み時に縮小・圧縮してレポートに保存する。
   表はタブ区切り（Excelからの貼り付け）で保持し、印刷時に本物の表として組む。
   ============================================ */

const ATT_MAX_DIM = 1200;            // 長辺(px)。A4で約180mm幅に使っても十分な解像度
const ATT_QUALITY = 0.82;
const ATT_SOFT_LIMIT = 4.2 * 1024 * 1024; // localStorageの目安(5MB)に対する警告ライン

// 添付の印刷位置に選べる項目
function attSectionOptions() {
  return [
    ...SECTIONS.map(s => ({ value: s.key, label: `${s.icon} ${s.label} の下` })),
    { value: '', label: '📎 日報の最後' },
  ];
}

function attList(dateKey = state.selectedDate) {
  const r = state.reports[dateKey];
  return (r && Array.isArray(r.attachments)) ? r.attachments : [];
}

function attEnsureList(dateKey) {
  if (!state.reports[dateKey]) state.reports[dateKey] = {};
  if (!Array.isArray(state.reports[dateKey].attachments)) state.reports[dateKey].attachments = [];
  return state.reports[dateKey].attachments;
}

// 図1 / 表1 … 日ごと・種類ごとの通し番号
function attLabel(att, list) {
  const same = list.filter(a => a.kind === att.kind);
  const n = same.indexOf(att) + 1;
  return att.kind === 'table' ? `表${n}` : `図${n}`;
}

function attChanged() {
  state.reports[state.selectedDate].updatedAt = new Date().toISOString();
  saveState();
  renderAttachments();
  renderCalendar();
  renderStats();
}

// ===== 取り込み =====
async function attAddImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return null;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    showToast('error', '❌ 読み込めません', 'この画像は取り込めませんでした');
    return null;
  }
  const scale = Math.min(1, ATT_MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // 透過PNGは白地にする（印刷が黒くならないように）
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close && bitmap.close();

  let src = canvas.toDataURL('image/webp', ATT_QUALITY);
  if (!src.startsWith('data:image/webp')) src = canvas.toDataURL('image/jpeg', ATT_QUALITY);

  return {
    id: generateId(),
    kind: 'image',
    src, w, h,
    name: file.name || '',
    caption: '',
    section: 'achieved',
    createdAt: new Date().toISOString(),
  };
}

async function attAddFiles(files) {
  const list = attEnsureList(state.selectedDate);
  let added = 0;
  for (const file of files) {
    const att = await attAddImageFile(file);
    if (att) { list.push(att); added++; }
  }
  if (!added) return;
  attChanged();
  showToast('success', '📎 追加しました', `図を${added}件追加しました`, 2500);
  const last = $('#attach-list .attach-item:last-child .attach-caption');
  if (last) last.focus();
}

// Excel/スプレッドシートからの貼り付け（タブ区切り）
function attParseTable(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines.length < 2) return null;
  const rows = lines.map(l => l.split('\t'));
  const cols = rows[0].length;
  if (cols < 2) return null;
  if (!rows.every(r => r.length === cols)) return null;
  return rows.map(r => r.join('\t')).join('\n');
}

function attAddTable(tsv) {
  const list = attEnsureList(state.selectedDate);
  list.push({
    id: generateId(),
    kind: 'table',
    tsv: tsv || '項目\t値\n\t',
    header: true,
    caption: '',
    section: 'achieved',
    createdAt: new Date().toISOString(),
  });
  attChanged();
  showToast('success', '📎 表を追加しました', 'セルはタブ区切りで編集できます', 2500);
  const last = $('#attach-list .attach-item:last-child .attach-tsv');
  if (last) last.focus();
}

function attHandlePaste(e) {
  const dt = e.clipboardData;
  if (!dt) return false;
  const files = [...(dt.files || [])].filter(f => f.type.startsWith('image/'));
  const items = [...(dt.items || [])].filter(i => i.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); attAddFiles(files); return true; }
  if (items.length) {
    const f = items[0].getAsFile();
    if (f) { e.preventDefault(); attAddFiles([f]); return true; }
  }
  const text = dt.getData('text/plain');
  const tsv = text && attParseTable(text);
  if (tsv) { e.preventDefault(); attAddTable(tsv); return true; }
  return false;
}

// ===== 表示 =====
function attUsageBytes() {
  try {
    return new Blob([JSON.stringify({ reports: state.reports, settings: state.settings })]).size;
  } catch (e) {
    return 0;
  }
}

function attFormatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function renderAttachments() {
  const wrap = $('#attach-list');
  if (!wrap) return;
  const list = attList();

  $('#attach-count').textContent = list.length ? `${list.length}件` : '';
  wrap.innerHTML = '';

  list.forEach((att, idx) => {
    const item = document.createElement('div');
    item.className = `attach-item attach-${att.kind}`;
    item.dataset.id = att.id;

    const label = attLabel(att, list);
    const options = attSectionOptions()
      .map(o => `<option value="${o.value}"${o.value === (att.section || '') ? ' selected' : ''}>${escapeHtml(o.label)}</option>`)
      .join('');

    const preview = att.kind === 'image'
      ? `<button type="button" class="attach-thumb" data-act="zoom" title="クリックで拡大"><img src="${att.src}" alt="${escapeHtml(att.caption || label)}" loading="lazy"></button>`
      : `<textarea class="attach-tsv" data-act="tsv" spellcheck="false" rows="4" aria-label="${label}の内容（タブ区切り）">${escapeHtml(att.tsv)}</textarea>`;

    item.innerHTML = `
      <div class="attach-head">
        <span class="attach-label">${label}</span>
        <input type="text" class="attach-caption" data-act="caption" value="${escapeHtml(att.caption)}"
               placeholder="説明（例：モデル別のF2スコア比較）" />
        <div class="attach-tools">
          <button type="button" class="attach-mini" data-act="up" title="上へ" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="attach-mini" data-act="down" title="下へ" ${idx === list.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="attach-mini danger" data-act="del" title="削除">🗑</button>
        </div>
      </div>
      ${preview}
      <div class="attach-foot-row">
        <label class="attach-where">印刷位置
          <select data-act="section">${options}</select>
        </label>
        ${att.kind === 'table'
          ? `<label class="attach-header-chk"><input type="checkbox" data-act="header" ${att.header ? 'checked' : ''}> 1行目は見出し</label>`
          : `<span class="attach-meta">${att.w}×${att.h}px ・ ${attFormatBytes(Math.round(att.src.length * 0.75))}</span>`}
      </div>
    `;
    wrap.appendChild(item);
  });

  const used = attUsageBytes();
  const usage = $('#attach-usage');
  usage.textContent = `保存データ ${attFormatBytes(used)}`;
  usage.classList.toggle('warn', used > ATT_SOFT_LIMIT);
  if (used > ATT_SOFT_LIMIT) {
    usage.textContent += '（ブラウザの保存上限が近いです。💾保存でファイルに退避してください）';
  }
}

// ===== 操作 =====
function attFind(id) {
  const list = attList();
  const i = list.findIndex(a => a.id === id);
  return { list, i, att: list[i] };
}

function attOnListEvent(e) {
  const item = e.target.closest('.attach-item');
  if (!item) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const { list, i, att } = attFind(item.dataset.id);
  if (!att) return;

  if (e.type === 'click') {
    if (act === 'del') {
      if (!confirm(`${attLabel(att, list)}を削除します。よろしいですか？`)) return;
      list.splice(i, 1);
      attChanged();
    } else if (act === 'up' && i > 0) {
      list.splice(i - 1, 0, list.splice(i, 1)[0]);
      attChanged();
    } else if (act === 'down' && i < list.length - 1) {
      list.splice(i + 1, 0, list.splice(i, 1)[0]);
      attChanged();
    } else if (act === 'zoom') {
      item.classList.toggle('zoomed');
    }
    return;
  }

  // input / change
  if (act === 'caption') {
    att.caption = e.target.value;
    attSaveSoon();
  } else if (act === 'tsv') {
    att.tsv = e.target.value;
    attSaveSoon();
  } else if (act === 'section') {
    att.section = e.target.value;
    attSaveSoon();
  } else if (act === 'header') {
    att.header = e.target.checked;
    attSaveSoon();
  }
}

let _attSaveTimer = null;
function attSaveSoon() {
  clearTimeout(_attSaveTimer);
  _attSaveTimer = setTimeout(() => {
    state.reports[state.selectedDate].updatedAt = new Date().toISOString();
    saveState();
  }, 400);
}

function initAttachments() {
  const drop = $('#attach-drop');
  const fileInput = $('#attach-file');

  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) attAddFiles([...fileInput.files]);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, (e) => {
    e.preventDefault();
    if (t === 'dragleave' && drop.contains(e.relatedTarget)) return;
    drop.classList.remove('over');
  }));
  drop.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) attAddFiles(files);
  });

  $('#attach-add-table').addEventListener('click', () => attAddTable());

  const list = $('#attach-list');
  list.addEventListener('click', attOnListEvent);
  list.addEventListener('input', attOnListEvent);
  list.addEventListener('change', attOnListEvent);

  // 貼り付け：日報の本文を編集中は通常の貼り付けのまま
  window.addEventListener('paste', (e) => {
    const el = document.activeElement;
    const typing = el && (el.matches('textarea[data-field]') || el.matches('input:not([type=file])') || el.isContentEditable);
    if (typing && !el.closest('#attach-card')) return;
    if (el && el.matches('.attach-tsv')) return;
    if (!$('#print-studio').classList.contains('hidden')) return;
    attHandlePaste(e);
  });
}
