import { detect, targetsFor, convert, mergeToPdf } from './engine.js';

const C = window.CONVERTER;
const $ = (id) => document.getElementById(id);

const ICONS = {
  video: '<path d="M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM17 10.5l5-3v9l-5-3"/>',
  audio: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  document: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8 13h3M8 17h8"/>'
};
const X_ICON = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';

const items = [];
let nextId = 1;

// ------------------------------------------------------------------ sidebar
function renderSidebar() {
  const list = $('categoryList');
  Object.entries(C.CATEGORIES).forEach(([key, cat]) => {
    const btn = document.createElement('button');
    btn.className = 'sb-item';
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `<span class="sb-icon cat-${key}"><svg viewBox="0 0 24 24">${ICONS[key]}</svg></span>
      <span>${cat.label}</span><span class="count">${cat.inputs.length}</span>`;
    const detail = document.createElement('div');
    detail.className = 'sb-detail';
    detail.hidden = true;
    const writes = [...new Set(cat.inputs.flatMap((e) => targetsFor(e).map((t) => t.ext)))];
    const chips = (arr) => `<div class="chips">${arr.map((e) => `<span class="chip">${e.toUpperCase()}</span>`).join('')}</div>`;
    detail.innerHTML = writes.length
      ? `<b>Opens</b>${chips(cat.inputs)}<b>Saves as</b>${chips(writes)}`
      : `<b>Opens</b>${chips(cat.inputs)}<b>Combine</b><div class="chips"><span class="chip">PDFs + images → one PDF</span></div>`;
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      detail.hidden = open;
    });
    list.append(btn, detail);
  });
}

// ------------------------------------------------------------------ helpers
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' bytes';
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + units[i];
}

const canShareFiles = (() => {
  try {
    return matchMedia('(pointer: coarse)').matches && !!navigator.canShare &&
      navigator.canShare({ files: [new File([''], 'x.txt', { type: 'text/plain' })] });
  } catch { return false; }
})();

// ------------------------------------------------------------------ adding files
async function addFiles(fileList) {
  for (const file of fileList) {
    const info = await detect(file);
    const targets = info ? targetsFor(info.ext) : [];
    const item = {
      id: nextId++, file, info, targets,
      target: targets[0] ? targets[0].ext : null,
      state: info && targets.length ? 'idle' : (info && info.category === 'pdf' ? 'mergeOnly' : 'unsupported'),
      progress: 0, message: '', result: null, url: null
    };
    items.push(item);
    item.el = buildRow(item);
    $('fileList').append(item.el);
    renderRow(item);
  }
  refresh();
}

function buildRow(item) {
  const li = document.createElement('li');
  li.className = 'file';
  const cat = item.info ? item.info.category : 'unknown';
  const ext = item.info ? item.info.ext : (C.extOf(item.file.name) || '?');
  li.innerHTML = `
    <div class="tile cat-${cat}">${ext.toUpperCase().slice(0, 4)}</div>
    <div class="file-info"><div class="file-name"></div><div class="file-meta"></div></div>
    <div class="file-actions"></div>
    <button class="icon-btn remove" aria-label="Remove">${X_ICON}</button>`;
  li.querySelector('.file-name').textContent = item.file.name;
  li.querySelector('.file-name').title = item.file.name;
  li.querySelector('.remove').addEventListener('click', () => removeItem(item));
  enableReorder(li, item);
  return li;
}

// ------------------------------------------------------------------ drag to reorder
let draggedItem = null;

function clearDropMarks() {
  document.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
}

function enableReorder(li, item) {
  li.draggable = true;
  li.addEventListener('dragstart', (e) => {
    if (e.target.closest('select, button')) { e.preventDefault(); return; }
    draggedItem = item;
    li.classList.add('dragging-row');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(item.id));
  });
  li.addEventListener('dragend', () => {
    li.classList.remove('dragging-row');
    draggedItem = null;
    clearDropMarks();
  });
  li.addEventListener('dragover', (e) => {
    if (!draggedItem || draggedItem === item) return;
    e.preventDefault();
    const r = li.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    clearDropMarks();
    li.classList.add(after ? 'drop-after' : 'drop-before');
  });
  li.addEventListener('drop', (e) => {
    if (!draggedItem || draggedItem === item) return;
    e.preventDefault();
    e.stopPropagation();
    const after = li.classList.contains('drop-after');
    clearDropMarks();
    items.splice(items.indexOf(draggedItem), 1);
    items.splice(items.indexOf(item) + (after ? 1 : 0), 0, draggedItem);
    li[after ? 'after' : 'before'](draggedItem.el);
    refresh();
  });
}

function removeItem(item) {
  if (item.state === 'working') return;
  mergeError = '';
  if (item.url) URL.revokeObjectURL(item.url);
  item.el.remove();
  items.splice(items.indexOf(item), 1);
  refresh();
}

// ------------------------------------------------------------------ rendering
function targetSelect(item) {
  const select = document.createElement('select');
  select.className = 'popup';
  select.setAttribute('aria-label', 'Convert to');
  const groups = {};
  item.targets.forEach((t) => {
    if (!groups[t.group]) {
      groups[t.group] = document.createElement('optgroup');
      groups[t.group].label = t.group;
      select.append(groups[t.group]);
    }
    const opt = new Option(`${t.ext.toUpperCase()} — ${t.label}`, t.ext, false, t.ext === item.target);
    groups[t.group].append(opt);
  });
  if (Object.keys(groups).length === 1) {
    // A single group needs no headers.
    const g = select.firstChild;
    while (g.firstChild) select.append(g.firstChild);
    g.remove();
  }
  select.value = item.target;
  select.addEventListener('change', () => {
    item.target = select.value;
    if (item.state === 'done' || item.state === 'error') { resetResult(item); renderRow(item); refresh(); }
  });
  return select;
}

function resetResult(item) {
  if (item.url) URL.revokeObjectURL(item.url);
  item.url = null; item.result = null; item.state = 'idle'; item.message = '';
}

function button(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = 'btn' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function renderRow(item) {
  const meta = item.el.querySelector('.file-meta');
  const actions = item.el.querySelector('.file-actions');
  const remove = item.el.querySelector('.remove');
  const catLabel = item.info ? C.CATEGORIES[item.info.category].label : '';
  const typeLabel = !item.info ? 'Unknown type'
    : item.info.ext.toUpperCase() === catLabel ? `${catLabel} document`
    : `${item.info.ext.toUpperCase()} · ${catLabel}`;
  meta.className = 'file-meta';
  actions.replaceChildren();
  remove.hidden = item.state === 'working';
  let bar = item.el.querySelector('.progress');

  switch (item.state) {
    case 'unsupported':
      meta.classList.add('error');
      meta.textContent = `${formatSize(item.file.size)} · This file type can’t be converted`;
      break;
    case 'mergeOnly':
      meta.textContent = `${typeLabel} · ${formatSize(item.file.size)} · Ready to merge`;
      break;
    case 'idle':
      meta.textContent = `${typeLabel} · ${formatSize(item.file.size)}`;
      actions.append(targetSelect(item), button('Convert', '', () => run(item)));
      break;
    case 'working':
      meta.textContent = item.message || 'Converting…';
      actions.append(Object.assign(document.createElement('div'), { className: 'spinner' }));
      break;
    case 'done': {
      meta.classList.add('done');
      const note = item.note || item.result.note;
      if (item.result.printable) {
        meta.textContent = '✓ Ready · choose “Save as PDF” in the print dialog';
        if (item.targets.length) actions.append(targetSelect(item));
        actions.append(button('Save as PDF…', 'primary', () => printToPdf(item)));
        break;
      }
      meta.textContent = `✓ ${resultName(item)} · ${formatSize(item.result.size)}` + (note ? ` · ${note}` : '');
      if (item.targets.length) actions.append(targetSelect(item));
      if (canShareFiles) actions.append(button('Share', '', () => share(item)));
      actions.append(button('Download', 'primary', () => download(item)));
      break;
    }
    case 'error':
      meta.classList.add('error');
      meta.textContent = item.message;
      actions.append(targetSelect(item), button('Try Again', '', () => run(item)));
      break;
  }

  if (item.state === 'working') {
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'progress';
      bar.innerHTML = '<i></i>';
      item.el.append(bar);
    }
    bar.classList.toggle('indeterminate', !item.progress);
    bar.firstChild.style.width = item.progress ? Math.round(item.progress * 100) + '%' : '';
  } else if (bar) {
    bar.remove();
  }
}

function refresh() {
  const total = items.length;
  const done = items.filter((i) => i.state === 'done').length;
  const working = items.some((i) => i.state === 'working');
  const pending = items.filter((i) => i.state === 'idle' || i.state === 'error').length;
  document.body.classList.toggle('has-files', total > 0);
  $('window').classList.toggle('has-files', total > 0);
  $('content').classList.toggle('has-files', total > 0);
  $('convertAllBtn').disabled = pending === 0 || working;
  $('clearBtn').hidden = total === 0 || working;
  $('status').textContent = total === 0 ? 'No files'
    : `${total} file${total > 1 ? 's' : ''}` + (done ? ` · ${done} converted` : '');
  $('subtitle').textContent = working || merging ? 'Converting on this device…' : 'Private · on-device';

  const mergeable = mergeCandidates();
  $('mergeBar').hidden = mergeable.length < 2;
  $('mergeTitle').textContent = merging ? 'Merging…' : `Merge ${mergeable.length} files into one PDF`;
  $('mergeBtn').disabled = merging || working;
  const hint = $('mergeHint');
  hint.textContent = mergeError || 'Pages follow the list order. Drag rows to reorder.';
  hint.classList.toggle('error', !!mergeError);
}

// ------------------------------------------------------------------ merge
let merging = false;
let mergeError = '';

function mergeCandidates() {
  return items.filter((i) => i.info && !i.isMergeResult &&
    (i.info.category === 'pdf' || i.info.category === 'image'));
}

async function mergeAll() {
  const entries = mergeCandidates();
  if (entries.length < 2 || merging) return;
  merging = true;
  mergeError = '';
  refresh();
  try {
    const { blob, pages } = await mergeToPdf(entries.map((i) => ({ file: i.file, info: i.info })));
    const file = new File([blob], 'Merged.pdf', { type: 'application/pdf' });
    const item = {
      id: nextId++, file, info: { ext: 'pdf', category: 'pdf' }, targets: [], target: 'pdf',
      state: 'done', progress: 0, message: '', result: blob, url: URL.createObjectURL(blob),
      note: `${pages} page${pages === 1 ? '' : 's'}`, isMergeResult: true
    };
    items.unshift(item);
    item.el = buildRow(item);
    $('fileList').prepend(item.el);
    renderRow(item);
    item.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (e) {
    console.error(e);
    mergeError = (e && e.message) || 'Merging failed.';
  } finally {
    merging = false;
    refresh();
  }
}

// ------------------------------------------------------------------ actions
async function run(item) {
  if (item.state === 'working' || !item.target) return;
  resetResult(item);
  item.state = 'working';
  item.progress = 0;
  item.message = 'Waiting…';
  renderRow(item); refresh();
  try {
    const blob = await convert(item.file, item.info, item.target, {
      onProgress: (p) => { item.progress = p; item.message = `Converting… ${Math.round(p * 100)}%`; renderRow(item); },
      onStatus: (s) => { item.message = s === 'Loading engine…' ? 'Loading converter engine (first time only)…' : s; renderRow(item); }
    });
    if (!blob || !blob.size) throw new Error('The conversion produced an empty file.');
    item.result = blob;
    item.url = URL.createObjectURL(blob);
    item.state = 'done';
  } catch (e) {
    console.error(e);
    item.state = 'error';
    item.message = (e && e.message) || 'Conversion failed.';
  }
  renderRow(item); refresh();
}

function resultName(item) {
  return (item.result && item.result.fileName) || C.outputName(item.file.name, item.target);
}

/** Open the converted page and its print dialog, where "Save as PDF" writes a real PDF. */
function printToPdf(item) {
  const win = window.open(item.url, '_blank');
  if (!win) {   // pop-up blocked: hand over the print-ready HTML instead
    const a = document.createElement('a');
    a.href = item.url;
    a.download = C.outputName(item.file.name, 'html');
    document.body.append(a); a.click(); a.remove();
    return;
  }
  const go = () => setTimeout(() => { try { win.focus(); win.print(); } catch { /* user can press ⌘P */ } }, 300);
  if (win.document && win.document.readyState === 'complete') go();
  else win.addEventListener('load', go, { once: true });
}

function download(item) {
  const a = document.createElement('a');
  a.href = item.url;
  a.download = resultName(item);
  document.body.append(a);
  a.click();
  a.remove();
}

async function share(item) {
  const file = new File([item.result], resultName(item), { type: item.result.type });
  try { await navigator.share({ files: [file] }); } catch { /* dismissed */ }
}

async function convertAll() {
  for (const item of items.filter((i) => i.state === 'idle' || i.state === 'error')) {
    await run(item);
  }
}

// ------------------------------------------------------------------ wiring
function openPicker() { $('fileInput').click(); }

$('fileInput').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
$('chooseBtn').addEventListener('click', openPicker);
$('addBtn').addEventListener('click', openPicker);
$('convertAllBtn').addEventListener('click', convertAll);
$('mergeBtn').addEventListener('click', mergeAll);
$('clearBtn').addEventListener('click', () => [...items].forEach(removeItem));

let dragDepth = 0;
const win = $('window');
window.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  e.preventDefault(); dragDepth++; win.classList.add('dragging');
});
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; win.classList.remove('dragging'); } });
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; win.classList.remove('dragging');
  if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]);
});
window.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) addFiles(files);
});

renderSidebar();
refresh();
