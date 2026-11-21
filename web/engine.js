// Converter — in-browser conversion engine. Nothing leaves the device.
//
//   audio / video ............ ffmpeg.wasm (engine downloaded once from a CDN, files stay local)
//   images ................... Canvas + hand-written BMP / TIFF / ICO / PDF encoders, ffmpeg for GIF
//   documents ................ marked (Markdown), mammoth (Word), DOM (HTML)
//   data & spreadsheets ...... shared/table.js (SheetJS + js-yaml) — same code as the Mac version

import { FFmpeg } from './vendor/ffmpeg/index.js';
import { toBlobURL } from './vendor/ffmpeg-util/index.js';

const C = window.CONVERTER;
const T = window.CONVERTER_TABLE;

const FFMPEG_CORE = window.CONVERTER_FFMPEG_CORE ||
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

// ------------------------------------------------------------------ capability
const DOC_IN = ['md', 'docx', 'html', 'txt'];
const DOC_OUT = ['html', 'txt'];

export function supports(src, target, category) {
  if (category === 'image') return target !== 'heic';           // browsers can't encode HEIC
  if (category === 'document') return DOC_IN.includes(src) && DOC_OUT.includes(target);
  return true;
}

export function targetsFor(ext) {
  return C.targetsFor(ext, supports);
}

export async function detect(file) {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  return C.detect(file.name, head);
}

// ------------------------------------------------------------------ script loading
const scripts = {};
function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }
  return scripts[src];
}

// ------------------------------------------------------------------ ffmpeg
let ffmpegPromise = null;
let queue = Promise.resolve();

function getFFmpeg(onStatus) {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      onStatus && onStatus('Loading engine…');
      const ff = new FFmpeg();
      await ff.load({
        coreURL: await toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.wasm`, 'application/wasm')
      });
      return ff;
    })().catch((e) => { ffmpegPromise = null; throw e; });
  }
  return ffmpegPromise;
}

/** Run ffmpeg on a blob. Calls are serialized: ffmpeg.wasm runs one job at a time. */
function runFFmpeg(blob, inExt, outExt, args, { onProgress, onStatus } = {}) {
  const job = queue.then(async () => {
    const ff = await getFFmpeg(onStatus);
    onStatus && onStatus('Converting…');
    const id = Math.random().toString(36).slice(2, 8);
    const inName = `in_${id}.${inExt}`;
    const outName = `out_${id}.${outExt}`;
    const logs = [];
    const onLog = ({ message }) => { logs.push(message); if (logs.length > 40) logs.shift(); };
    const onProg = ({ progress }) => {
      if (onProgress && progress >= 0 && progress <= 1) onProgress(progress);
    };
    ff.on('log', onLog);
    ff.on('progress', onProg);
    try {
      await ff.writeFile(inName, new Uint8Array(await blob.arrayBuffer()));
      const code = await ff.exec(['-hide_banner', '-i', inName, ...args, '-y', outName]);
      if (code !== 0) throw new Error(explain(logs));
      const data = await ff.readFile(outName);
      return new Blob([data], { type: C.MIME[outExt] || 'application/octet-stream' });
    } finally {
      ff.off('log', onLog);
      ff.off('progress', onProg);
      await ff.deleteFile(inName).catch(() => {});
      await ff.deleteFile(outName).catch(() => {});
    }
  });
  queue = job.catch(() => {});
  return job;
}

function explain(logs) {
  const text = logs.join('\n');
  if (/does not contain any stream|Output file .* does not contain/i.test(text)) return 'This file has no usable audio or video track.';
  if (/Invalid data found/i.test(text)) return 'The file looks damaged or isn’t really this format.';
  if (/out of memory|Cannot allocate/i.test(text)) return 'File too large for this browser. Try the Mac Quick Action.';
  const err = logs.filter((l) => /error|invalid|unknown|not supported/i.test(l)).pop();
  return err ? err.trim().slice(0, 160) : 'Conversion failed.';
}

// ------------------------------------------------------------------ images
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

async function decodeImage(file, ext, opts) {
  try {
    return await loadImage(file);
  } catch {
    if (ext === 'heic') {
      throw new Error('This browser can’t open HEIC photos. Open this page in Safari, or use the Mac Quick Action.');
    }
    if (ext === 'svg') throw new Error('This SVG could not be read.');
    // e.g. TIFF in Chrome: let ffmpeg decode it to PNG first.
    const png = await runFFmpeg(file, ext, 'png', C.ffmpegArgs('png', 'image'), opts);
    return loadImage(png);
  }
}

function drawToCanvas(img, ext, { background, maxSide } = {}) {
  let w = img.naturalWidth || img.width || 1024;
  let h = img.naturalHeight || img.height || 1024;
  let scale = 1;
  if (ext === 'svg') scale = Math.max(1, 2048 / Math.max(w, h));   // rasterize vectors crisply
  if (maxSide) scale = Math.min(scale, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

function canvasBlob(canvas, mime, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

function encodeBMP(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const row = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + row * h;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  const out = new Uint8Array(buf);
  v.setUint16(0, 0x4D42, true); v.setUint32(2, size, true); v.setUint32(10, 54, true);
  v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true);
  v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, row * h, true);
  v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    const o = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[o + x * 3] = px[i + 2]; out[o + x * 3 + 1] = px[i + 1]; out[o + x * 3 + 2] = px[i];
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

function encodeTIFF(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const entries = [
    [256, 4, w], [257, 4, h], [258, 3, 4, 146], [259, 3, 1], [262, 3, 2], [273, 4, 154],
    [277, 3, 4], [278, 4, h], [279, 4, w * h * 4], [284, 3, 1], [338, 3, 2]
  ];
  const buf = new ArrayBuffer(154 + w * h * 4);
  const v = new DataView(buf);
  v.setUint16(0, 0x4949, true); v.setUint16(2, 42, true); v.setUint32(4, 8, true);
  v.setUint16(8, entries.length, true);
  entries.forEach(([tag, type, a, offset], k) => {
    const o = 10 + k * 12;
    v.setUint16(o, tag, true); v.setUint16(o + 2, type, true);
    v.setUint32(o + 4, offset ? a : 1, true);
    if (offset) v.setUint32(o + 8, offset, true);
    else if (type === 3) v.setUint16(o + 8, a, true);
    else v.setUint32(o + 8, a, true);
  });
  v.setUint32(10 + entries.length * 12, 0, true);
  for (let k = 0; k < 4; k++) v.setUint16(146 + k * 2, 8, true);
  new Uint8Array(buf, 154).set(px);
  return new Blob([buf], { type: 'image/tiff' });
}

async function encodeICO(canvas) {
  const png = new Uint8Array(await (await canvasBlob(canvas, 'image/png')).arrayBuffer());
  const buf = new ArrayBuffer(22 + png.length);
  const v = new DataView(buf);
  v.setUint16(2, 1, true); v.setUint16(4, 1, true);
  v.setUint8(6, canvas.width >= 256 ? 0 : canvas.width);
  v.setUint8(7, canvas.height >= 256 ? 0 : canvas.height);
  v.setUint16(10, 1, true); v.setUint16(12, 32, true);
  v.setUint32(14, png.length, true); v.setUint32(18, 22, true);
  new Uint8Array(buf, 22).set(png);
  return new Blob([buf], { type: 'image/x-icon' });
}

async function encodePDF(canvas) {
  const jpg = new Uint8Array(await (await canvasBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
  const { width: w, height: h } = canvas;
  const scale = Math.min(0.75, 842 / Math.max(w, h));   // fit an A4-sized page, keep full resolution
  const pw = (w * scale).toFixed(2);
  const ph = (h * scale).toFixed(2);
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (chunk) => { const b = typeof chunk === 'string' ? enc.encode(chunk) : chunk; parts.push(b); length += b.length; };
  const obj = (n, body) => { offsets[n] = length; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] ` +
    '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'));
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB ` +
      `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
    push(jpg);
    push('\nendstream');
  });
  obj(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const xref = length;
  push('xref\n0 6\n0000000000 65535 f \n' +
    offsets.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

async function convertImage(file, ext, target, opts) {
  if (['mp4', 'webm', 'mov'].includes(target) || (target === 'webp' && ext === 'gif')) {
    return runFFmpeg(file, ext, target, C.ffmpegArgs(target, 'image'), opts);  // animated GIF → video / animated WebP
  }
  const img = await decodeImage(file, ext, opts);
  const opaque = ['jpg', 'bmp', 'pdf'].includes(target);
  const canvas = drawToCanvas(img, ext, {
    background: opaque ? '#ffffff' : null,
    maxSide: target === 'ico' ? 256 : null
  });
  switch (target) {
    case 'jpg': return canvasBlob(canvas, 'image/jpeg', 0.92);
    case 'png': return canvasBlob(canvas, 'image/png');
    case 'webp': {
      const b = await canvasBlob(canvas, 'image/webp', 0.9);
      if (b && b.type === 'image/webp') return b;
      const png = await canvasBlob(canvas, 'image/png');           // older Safari can't encode WebP
      return runFFmpeg(png, 'png', 'webp', C.ffmpegArgs('webp', 'image'), opts);
    }
    case 'bmp': return encodeBMP(canvas);
    case 'tiff': return encodeTIFF(canvas);
    case 'ico': return encodeICO(canvas);
    case 'pdf': return encodePDF(canvas);
    case 'gif': {
      const png = await canvasBlob(canvas, 'image/png');
      return runFFmpeg(png, 'png', 'gif', C.ffmpegArgs('gif', 'image'), opts);
    }
  }
  throw new Error('Unsupported image format');
}

// ------------------------------------------------------------------ documents
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,head').forEach((n) => n.remove());
  // Drop whitespace-only text between tags so lists don't get blank lines.
  const walker = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_TEXT);
  const blanks = [];
  while (walker.nextNode()) if (!walker.currentNode.textContent.trim() && !walker.currentNode.parentElement.closest('pre')) blanks.push(walker.currentNode);
  blanks.forEach((n) => n.remove());
  doc.querySelectorAll('li').forEach((n) => n.prepend('• '));
  doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr,pre,blockquote,section,article').forEach((n) => n.append('\n'));
  doc.querySelectorAll('td,th').forEach((n) => n.append('\t'));
  return (doc.body ? doc.body.textContent : '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function textToHtml(text) {
  return text.split(/\n{2,}/).map((p) => '<p>' + C.escapeHtml(p).replace(/\n/g, '<br>') + '</p>').join('\n');
}

async function convertDocument(file, ext, target) {
  const title = file.name.replace(/\.[^.]+$/, '');
  let html;
  if (ext === 'docx') {
    await loadScript('vendor/mammoth.browser.min.js');
    const arrayBuffer = await file.arrayBuffer();
    if (target === 'txt') {
      const r = await window.mammoth.extractRawText({ arrayBuffer });
      return new Blob([r.value], { type: 'text/plain;charset=utf-8' });
    }
    html = (await window.mammoth.convertToHtml({ arrayBuffer })).value;
  } else {
    const text = await file.text();
    if (ext === 'md') {
      await loadScript('../shared/vendor/marked.umd.js');
      html = window.marked.parse(text);
    } else if (ext === 'html') {
      if (target === 'txt') return new Blob([htmlToText(text)], { type: 'text/plain;charset=utf-8' });
    } else {
      html = textToHtml(text);
    }
  }
  if (target === 'txt') return new Blob([htmlToText(html)], { type: 'text/plain;charset=utf-8' });
  return new Blob([C.htmlDocument(title, html)], { type: 'text/html;charset=utf-8' });
}

// ------------------------------------------------------------------ tables
function base64FromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function bytesFromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function convertTable(file, ext, target) {
  if (T.needsYAML(ext, target)) await loadScript('../shared/vendor/js-yaml.min.js');
  if (T.needsXLSX(ext, target)) await loadScript('../shared/vendor/xlsx.full.min.js');
  const input = T.isBinaryInput(ext)
    ? base64FromBytes(new Uint8Array(await file.arrayBuffer()))
    : await file.text();
  const res = T.convert(ext, input, target, file.name.replace(/\.[^.]+$/, ''));
  const type = C.MIME[target] || 'application/octet-stream';
  return res.base64 ? new Blob([bytesFromBase64(res.base64)], { type }) : new Blob([res.text], { type: type + ';charset=utf-8' });
}

// ------------------------------------------------------------------ merge
export const canMerge = (infos) => C.canMerge(infos);

/**
 * Merge PDFs and images into one PDF, in the given order.
 * entries: [{ file, info }]. Returns { blob, pages }.
 */
export async function mergeToPdf(entries, { onProgress } = {}) {
  await loadScript('vendor/pdf-lib.min.js');
  const { PDFDocument } = window.PDFLib;
  const out = await PDFDocument.create();

  for (let i = 0; i < entries.length; i++) {
    const { file, info } = entries[i];
    if (info.category === 'pdf') {
      try {
        const src = await PDFDocument.load(await file.arrayBuffer());
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      } catch (e) {
        throw new Error(/encrypt/i.test(String(e && e.message))
          ? `“${file.name}” is password-protected. Remove the password and try again.`
          : `“${file.name}” is damaged or isn’t a real PDF.`);
      }
    } else {
      const img = await embedImage(out, file, info.ext);
      const scale = Math.min(0.75, 842 / Math.max(img.width, img.height));
      const w = img.width * scale;
      const h = img.height * scale;
      out.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    }
    if (onProgress) onProgress((i + 1) / entries.length);
  }

  const bytes = await out.save();
  return { blob: new Blob([bytes], { type: 'application/pdf' }), pages: out.getPageCount() };
}

async function embedImage(doc, file, ext) {
  try {
    if (ext === 'jpg') return await doc.embedJpg(await file.arrayBuffer());
    if (ext === 'png') return await doc.embedPng(await file.arrayBuffer());
  } catch { /* unusual JPEG/PNG variant: re-encode below */ }
  const img = await decodeImage(file, ext);
  const canvas = drawToCanvas(img, ext);
  return doc.embedPng(await (await canvasBlob(canvas, 'image/png')).arrayBuffer());
}

// ------------------------------------------------------------------ entry point
/**
 * Convert a File. `info` comes from detect(). Returns a Blob.
 * opts: { onProgress(0..1), onStatus(text) }
 */
export async function convert(file, info, target, opts = {}) {
  const { ext, category } = info;
  switch (category) {
    case 'video':
    case 'audio':
      return runFFmpeg(file, ext, target, C.ffmpegArgs(target, category), opts);
    case 'image':
      return convertImage(file, ext, target, opts);
    case 'document':
      return convertDocument(file, ext, target);
    case 'table':
      return convertTable(file, ext, target);
  }
  throw new Error('Unsupported file');
}
