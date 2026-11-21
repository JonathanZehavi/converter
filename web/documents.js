// Converter — Word (.docx) writing and PDF reading, entirely in the browser.
//
//   HTML → DOCX ......... hand-built Office Open XML, zipped with JSZip (RTL-aware)
//   PDF → text blocks ... pdf.js text extraction, regrouped into lines and paragraphs
//   PDF → images ........ pdf.js rendering, one image per page (zip when several)

const C = window.CONVERTER;

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

async function getZip() {
  await loadScript('vendor/jszip.min.js');
  return new window.JSZip();
}

// ------------------------------------------------------------------ blocks
// A block is a paragraph: { runs: [{ text, bold, italic, br }], size (pt), heading, dir, pageBreak }

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'BLOCKQUOTE', 'TR',
  'DIV', 'SECTION', 'ARTICLE', 'UL', 'OL', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'BODY', 'HEADER',
  'FOOTER', 'MAIN', 'NAV', 'ASIDE', 'DL', 'DT', 'DD', 'FIGURE', 'HR']);
const HEADING_SIZE = { H1: 20, H2: 16, H3: 14, H4: 12, H5: 11, H6: 11 };

function blockText(block) {
  return block.runs.map((r) => (r.br ? '\n' : r.text)).join('');
}

function finishBlock(blocks, block) {
  const text = blockText(block).trim();
  if (!text) return;
  block.dir = C.textDirection(text);
  blocks.push(block);
}

/** Flatten HTML into paragraphs with bold / italic runs. */
export function htmlToBlocks(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, head, title').forEach((n) => n.remove());
  const blocks = [];

  function inline(node, fmt, runs) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent.replace(/\s+/g, ' ');
        if (text) runs.push({ text, bold: !!fmt.bold, italic: !!fmt.italic });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName;
        if (tag === 'BR') runs.push({ br: true, text: '' });
        else if (tag === 'B' || tag === 'STRONG') inline(child, { ...fmt, bold: true }, runs);
        else if (tag === 'I' || tag === 'EM') inline(child, { ...fmt, italic: true }, runs);
        else if (tag === 'TD' || tag === 'TH') { inline(child, fmt, runs); runs.push({ text: '\t' }); }
        else inline(child, fmt, runs);
      }
    }
  }

  function walk(el) {
    let pending = { runs: [] };
    const flush = () => { finishBlock(blocks, pending); pending = { runs: [] }; };
    for (const child of el.childNodes) {
      const isBlock = child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(child.tagName);
      if (!isBlock) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent.replace(/\s+/g, ' ');
          if (text.trim()) pending.runs.push({ text });
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          inline({ childNodes: [child] }, {}, pending.runs);
        }
        continue;
      }
      flush();
      const tag = child.tagName;
      if (HEADING_SIZE[tag]) {
        const b = { runs: [], size: HEADING_SIZE[tag], heading: true };
        inline(child, { bold: true }, b.runs);
        finishBlock(blocks, b);
      } else if (tag === 'LI') {
        const b = { runs: [{ text: '• ' }] };
        const nested = [];
        for (const n of child.childNodes) {
          if (n.nodeType === Node.ELEMENT_NODE && (n.tagName === 'UL' || n.tagName === 'OL')) nested.push(n);
          else inline({ childNodes: [n] }, {}, b.runs);
        }
        finishBlock(blocks, b);
        nested.forEach(walk);
      } else if (tag === 'P' || tag === 'PRE' || tag === 'BLOCKQUOTE' || tag === 'TR' || tag === 'DT' || tag === 'DD') {
        const b = { runs: [] };
        if (tag === 'PRE') b.runs.push({ text: child.textContent });
        else inline(child, {}, b.runs);
        finishBlock(blocks, b);
      } else if (tag !== 'HR') {
        walk(child);
      }
    }
    flush();
  }

  walk(doc.body || doc.documentElement);
  return blocks;
}

export function blocksToText(blocks) {
  return blocks.map((b) => (b.pageBreak ? '' : blockText(b).trim())).filter((t, i, a) => t || (i && a[i - 1])).join('\n\n')
    .replace(/\n{3,}/g, '\n\n') + '\n';
}

export function blocksToHtml(blocks, title) {
  const esc = C.escapeHtml;
  const body = blocks.map((b) => {
    if (b.pageBreak) return '<hr>';
    const inner = b.runs.map((r) => {
      if (r.br) return '<br>';
      let t = esc(r.text);
      if (r.bold) t = `<strong>${t}</strong>`;
      if (r.italic) t = `<em>${t}</em>`;
      return t;
    }).join('');
    return b.heading ? `<h2>${inner}</h2>` : `<p>${inner}</p>`;
  }).join('\n');
  return C.htmlDocument(title, body);
}

// ------------------------------------------------------------------ DOCX
function xmlEscape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    // strip characters XML 1.0 forbids
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function runXml(run, block) {
  if (run.br) return '<w:r><w:br/></w:r>';
  const props = ['<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>'];
  if (run.bold || block.heading) props.push('<w:b/><w:bCs/>');
  if (run.italic) props.push('<w:i/><w:iCs/>');
  const half = Math.round((block.size || 11) * 2);
  props.push(`<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`);
  if (block.dir === 'rtl') props.push('<w:rtl/>');
  return run.text.split('\t').map((part, i) =>
    (i ? '<w:r><w:tab/></w:r>' : '') +
    (part ? `<w:r><w:rPr>${props.join('')}</w:rPr><w:t xml:space="preserve">${xmlEscape(part)}</w:t></w:r>` : '')
  ).join('');
}

function blockXml(block) {
  if (block.pageBreak) return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const ppr = [];
  if (block.dir === 'rtl') ppr.push('<w:bidi/>');
  ppr.push(block.heading ? '<w:spacing w:before="240" w:after="120"/>' : '<w:spacing w:after="120"/>');
  return `<w:p><w:pPr>${ppr.join('')}</w:pPr>${block.runs.map((r) => runXml(r, block)).join('')}</w:p>`;
}

export async function blocksToDocx(blocks) {
  const zip = await getZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>');
  zip.file('word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    blocks.map(blockXml).join('') +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>');
  return zip.generateAsync({ type: 'blob', mimeType: C.MIME.docx });
}

// ------------------------------------------------------------------ PDF
async function openPdf(file) {
  const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new Error(`“${file.name}” is password-protected.`);
    throw new Error(`“${file.name}” is damaged or isn’t a real PDF.`);
  }
}

/** Extract paragraphs from a PDF's text layer. */
export async function pdfToBlocks(file, onProgress) {
  const pdf = await openPdf(file);
  const blocks = [];
  const sizes = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      const h = Math.abs(it.height || it.transform[3]) || 10;
      let line = lines.find((l) => Math.abs(l.y - y) < Math.max(2, Math.min(l.h, h) * 0.5));
      if (!line) { line = { y, h, items: [] }; lines.push(line); }
      line.items.push({ x, w: it.width, h, str: it.str, rtl: it.dir === 'rtl' });
      line.h = Math.max(line.h, h);
    }
    lines.sort((a, b) => b.y - a.y);

    let current = null;
    let prev = null;
    for (const line of lines) {
      const rtlCount = line.items.filter((i) => i.rtl).length;
      const rtl = rtlCount * 2 > line.items.length;
      line.items.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
      let text = '';
      line.items.forEach((it, i) => {
        if (i) {
          const before = line.items[i - 1];
          const gap = rtl ? before.x - (it.x + it.w) : it.x - (before.x + before.w);
          if (gap > it.h * 0.15 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
        }
        text += it.str;
      });
      text = text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      sizes.push(line.h);

      const sameParagraph = current && prev &&
        prev.y - line.y < Math.max(prev.h, line.h) * 1.6 &&
        Math.abs(prev.h - line.h) < Math.max(prev.h, line.h) * 0.2 &&
        current.rtl === rtl;
      if (sameParagraph) {
        current.runs[0].text += (/-$/.test(current.runs[0].text) ? '' : ' ') + text;
      } else {
        current = { runs: [{ text }], size: line.h, rtl };
        blocks.push(current);
      }
      prev = line;
    }
    if (p < pdf.numPages) blocks.push({ pageBreak: true, runs: [] });
    if (onProgress) onProgress(p / pdf.numPages);
  }

  const textBlocks = blocks.filter((b) => !b.pageBreak);
  if (!textBlocks.length) {
    throw new Error('This PDF has no text layer (it’s probably a scan). Convert it to JPG or PNG instead.');
  }
  // Headings: noticeably larger than the typical line.
  const median = sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)] || 10;
  for (const b of textBlocks) {
    b.dir = C.textDirection(b.runs[0].text);
    b.heading = b.size > median * 1.25;
    b.size = Math.max(9, Math.min(28, Math.round((b.size / median) * 11)));
  }
  return blocks;
}

/** Render every page. Returns one image, or a zip when there are several pages. */
export async function pdfToImages(file, fmt, onProgress) {
  const pdf = await openPdf(file);
  const mime = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
  const base = file.name.replace(/\.[^.]+$/, '');
  const images = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const unit = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 4000 / Math.max(unit.width, unit.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(await new Promise((r) => canvas.toBlob(r, mime, 0.9)));
    canvas.width = canvas.height = 0; // free memory early on phones
    if (onProgress) onProgress(p / pdf.numPages);
  }
  if (images.length === 1) return images[0];
  const zip = await getZip();
  images.forEach((img, i) => zip.file(`${base} - page ${i + 1}.${fmt}`, img));
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  blob.fileName = `${base} (${images.length} pages).zip`;
  blob.note = `${images.length} pages`;
  return blob;
}
