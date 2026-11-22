/*
 * Converter — shared format registry.
 *
 * One source of truth for BOTH the web app (browser) and the Mac Quick Action
 * (JavaScript for Automation). Plain script, no modules, no DOM access, so it
 * runs in either environment. It defines a single global: CONVERTER.
 */
var CONVERTER = (function () {
  'use strict';

  // ---------------------------------------------------------------- categories
  var CATEGORIES = {
    video: {
      label: 'Video',
      inputs: ['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'mpg', 'ts', 'mts', 'm2ts', '3gp', 'ogv', 'vob'],
      targets: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'gif', 'mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus']
    },
    audio: {
      label: 'Audio',
      inputs: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'wma', 'caf', 'amr', 'ac3', 'alac', 'm4b'],
      targets: ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aiff', 'aac']
    },
    image: {
      label: 'Image',
      inputs: ['jpg', 'png', 'gif', 'webp', 'heic', 'avif', 'bmp', 'tiff', 'ico', 'svg'],
      targets: ['jpg', 'png', 'webp', 'heic', 'gif', 'tiff', 'bmp', 'ico', 'pdf']
    },
    document: {
      label: 'Document',
      inputs: ['docx', 'doc', 'odt', 'rtf', 'html', 'md', 'txt'],
      targets: ['pdf', 'docx', 'doc', 'odt', 'rtf', 'html', 'txt']
    },
    table: {
      label: 'Data & Sheets',
      inputs: ['xlsx', 'xls', 'ods', 'csv', 'tsv', 'json', 'yaml'],
      targets: ['xlsx', 'ods', 'csv', 'tsv', 'json', 'yaml', 'html']
    },
    pdf: {
      label: 'PDF',
      inputs: ['pdf'],
      targets: ['docx', 'rtf', 'txt', 'html', 'jpg', 'png'] // several PDFs can also be merged (canMerge)
    }
  };

  // Several PDFs and/or images can be merged into one PDF, in the given order.
  var MERGE_TARGET = { ext: 'merge-pdf', label: 'One PDF, in order', group: 'Merge', badge: 'PDF', title: 'Merge into PDF' };

  // Animated GIFs can also become real video files.
  var EXTRA_TARGETS = { gif: ['mp4', 'webm', 'mov'] };

  var ALIASES = {
    jpeg: 'jpg', jpe: 'jpg', jfif: 'jpg', tif: 'tiff', heif: 'heic', hif: 'heic',
    aif: 'aiff', aifc: 'aiff', oga: 'ogg', mpeg: 'mpg', mpe: 'mpg', qt: 'mov',
    htm: 'html', xhtml: 'html', markdown: 'md', text: 'txt', yml: 'yaml', svgz: 'svg'
  };

  var LABELS = {
    mp4: 'MPEG-4 Video', mov: 'QuickTime Movie', mkv: 'Matroska Video', webm: 'WebM Video',
    avi: 'AVI Video', gif: 'GIF Image', mp3: 'MP3 Audio', m4a: 'AAC Audio (M4A)',
    wav: 'WAV · Lossless', flac: 'FLAC · Lossless', ogg: 'Ogg Vorbis', opus: 'Opus Audio',
    aiff: 'AIFF · Lossless', aac: 'AAC Audio (raw)', jpg: 'JPEG Image', png: 'PNG Image',
    webp: 'WebP Image', heic: 'HEIC Image', tiff: 'TIFF Image', bmp: 'Bitmap Image',
    ico: 'Windows Icon', pdf: 'PDF Document', docx: 'Word Document', doc: 'Word 97–2004',
    odt: 'OpenDocument Text', rtf: 'Rich Text', html: 'Web Page', txt: 'Plain Text',
    md: 'Markdown', xlsx: 'Excel Workbook', ods: 'OpenDocument Sheet', csv: 'CSV Table',
    tsv: 'TSV Table', json: 'JSON', yaml: 'YAML'
  };

  // Labels that depend on the source: from a PDF only the text (and page images) can be recovered.
  var SOURCE_LABELS = {
    pdf: {
      docx: 'Word (text only)', rtf: 'Rich Text (text only)', html: 'Web page (text only)',
      txt: 'Plain Text', jpg: 'JPEG, per page', png: 'PNG, per page'
    }
  };

  var MIME = {
    mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm',
    avi: 'video/x-msvideo', gif: 'image/gif', mp3: 'audio/mpeg', m4a: 'audio/mp4',
    wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg',
    aiff: 'audio/aiff', aac: 'audio/aac', jpg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', heic: 'image/heic', tiff: 'image/tiff', bmp: 'image/bmp',
    ico: 'image/x-icon', pdf: 'application/pdf', svg: 'image/svg+xml',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword', odt: 'application/vnd.oasis.opendocument.text',
    rtf: 'application/rtf', html: 'text/html', txt: 'text/plain', md: 'text/markdown',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ods: 'application/vnd.oasis.opendocument.spreadsheet', csv: 'text/csv',
    tsv: 'text/tab-separated-values', json: 'application/json', yaml: 'application/yaml'
  };

  var EXT_CATEGORY = {};
  Object.keys(CATEGORIES).forEach(function (cat) {
    CATEGORIES[cat].inputs.forEach(function (ext) { EXT_CATEGORY[ext] = cat; });
  });

  // ---------------------------------------------------------------- detection
  function normalizeExt(ext) {
    ext = String(ext || '').toLowerCase().replace(/^\./, '');
    return ALIASES[ext] || ext;
  }

  function extOf(name) {
    var base = String(name || '').split('/').pop();
    var dot = base.lastIndexOf('.');
    return dot > 0 ? normalizeExt(base.slice(dot + 1)) : '';
  }

  function ascii(b, start, len) {
    var s = '';
    for (var i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
  }

  /** Identify a file from its first bytes (Uint8Array or array). Returns an ext or null. */
  function sniff(b) {
    if (!b || b.length < 4) return null;
    var h4 = ascii(b, 0, 4);
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
    if (b[0] === 0x89 && h4.slice(1) === 'PNG') return 'png';
    if (h4 === 'GIF8') return 'gif';
    if (h4 === 'RIFF') {
      var sub = ascii(b, 8, 4);
      if (sub === 'WEBP') return 'webp';
      if (sub === 'WAVE') return 'wav';
      if (sub === 'AVI ') return 'avi';
    }
    if (h4 === 'FORM' && /^AIF[FC]$/.test(ascii(b, 8, 4))) return 'aiff';
    if ((h4 === 'II*\u0000') || (h4 === 'MM\u0000*')) return 'tiff';
    if (ascii(b, 4, 4) === 'ftyp') {
      var brand = ascii(b, 8, 4);
      if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return 'heic';
      if (/^avi[fs]$/.test(brand)) return 'avif';
      if (/^M4[AB] $/.test(brand)) return 'm4a';
      if (brand === 'qt  ') return 'mov';
      if (/^3g/.test(brand)) return '3gp';
      return 'mp4';
    }
    if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) {
      return ascii(b, 0, 64).indexOf('webm') >= 0 ? 'webm' : 'mkv';
    }
    if (h4 === 'fLaC') return 'flac';
    if (h4 === 'OggS') return ascii(b, 28, 8).indexOf('OpusHead') === 0 ? 'opus' : 'ogg';
    if (h4.slice(0, 3) === 'ID3' || (b[0] === 0xFF && (b[1] & 0xE6) === 0xE2)) return 'mp3';
    if (h4 === 'caff') return 'caf';
    if (h4.slice(0, 3) === 'FLV') return 'flv';
    if (b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xB2 && b[3] === 0x75) return 'wmv';
    if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0xBA) return 'mpg';
    if (b[0] === 0x47 && b.length > 188 && b[188] === 0x47) return 'ts';
    if (h4 === '%PDF') return 'pdf';
    if (h4 === '{\\rt') return 'rtf';
    if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'ico';
    if (b[0] === 0x42 && b[1] === 0x4D && b.length > 14) return 'bmp';
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return 'xls'; // legacy OLE (xls / doc)
    var head = ascii(b, 0, Math.min(b.length, 256)).replace(/^﻿|^ï»¿/, '').trim().toLowerCase();
    if (head.indexOf('<svg') === 0 || (head.indexOf('<?xml') === 0 && head.indexOf('<svg') > 0)) return 'svg';
    if (head.indexOf('<!doctype html') === 0 || head.indexOf('<html') === 0) return 'html';
    if (head[0] === '{' || head[0] === '[') return 'json';
    return null;
  }

  /** Detect a file's format. Trusts a known extension, falls back to magic bytes. */
  function detect(name, bytes) {
    var ext = extOf(name);
    if (!EXT_CATEGORY[ext] && bytes) {
      var sniffed = sniff(bytes);
      if (sniffed && EXT_CATEGORY[sniffed]) ext = sniffed;
    }
    if (!EXT_CATEGORY[ext]) return null;
    return { ext: ext, category: EXT_CATEGORY[ext] };
  }

  /**
   * Formats a file of `ext` can become. `supports(srcExt, targetExt, category)`
   * lets each platform drop what its engines cannot do.
   */
  function targetsFor(ext, supports) {
    ext = normalizeExt(ext);
    var cat = EXT_CATEGORY[ext];
    if (!cat) return [];
    var list = CATEGORIES[cat].targets.concat(EXTRA_TARGETS[ext] || []);
    var seen = {};
    return list.filter(function (t) {
      if (t === ext || seen[t]) return false;
      seen[t] = true;
      return !supports || supports(ext, t, cat);
    }).map(function (t) {
      var label = (SOURCE_LABELS[cat] && SOURCE_LABELS[cat][t]) || LABELS[t] || t.toUpperCase();
      return { ext: t, label: label, group: groupOf(t) };
    });
  }

  function groupOf(ext) {
    if (ext === 'pdf') return 'Document';
    if (CATEGORIES.video.targets.slice(0, 5).indexOf(ext) >= 0) return 'Video';
    if (CATEGORIES.audio.targets.indexOf(ext) >= 0) return 'Audio';
    return CATEGORIES[EXT_CATEGORY[ext]] ? CATEGORIES[EXT_CATEGORY[ext]].label : 'Other';
  }

  // ---------------------------------------------------------------- ffmpeg
  // Identical encoder settings on the Mac (Homebrew ffmpeg) and the web (ffmpeg.wasm).
  var EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  var H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-vf', EVEN];
  var VIDEO_ARGS = {
    mp4: H264.concat(['-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']),
    mov: H264.concat(['-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']),
    mkv: H264.concat(['-c:a', 'aac', '-b:a', '160k']),
    webm: ['-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8',
      '-row-mt', '1', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '128k'],
    avi: ['-c:v', 'mpeg4', '-q:v', '4', '-vtag', 'xvid', '-c:a', 'libmp3lame', '-q:a', '4'],
    gif: ['-vf', "fps=12,scale='min(480,iw)':-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
      '-loop', '0', '-an']
  };
  var AUDIO_ARGS = {
    mp3: ['-c:a', 'libmp3lame', '-q:a', '2'],
    m4a: ['-c:a', 'aac', '-b:a', '192k'],
    aac: ['-c:a', 'aac', '-b:a', '192k', '-f', 'adts'],
    wav: ['-c:a', 'pcm_s16le'],
    aiff: ['-c:a', 'pcm_s16be'],
    flac: ['-c:a', 'flac'],
    ogg: ['-c:a', 'libvorbis', '-q:a', '5'],
    opus: ['-c:a', 'libopus', '-b:a', '128k']
  };
  var IMAGE_ARGS = {
    webp: ['-c:v', 'libwebp', '-quality', '85', '-loop', '0'],
    ico: ['-vf', 'scale=256:256:force_original_aspect_ratio=decrease', '-frames:v', '1'],
    gif: ['-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', '-frames:v', '1'],
    png: ['-frames:v', '1']
  };

  /** ffmpeg arguments placed between `-i input` and the output path. */
  function ffmpegArgs(target, sourceCategory) {
    if (sourceCategory === 'image') {
      if (target === 'gif' || !VIDEO_ARGS[target]) return (IMAGE_ARGS[target] || []).slice();
      return VIDEO_ARGS[target].slice(); // animated GIF -> video
    }
    if (AUDIO_ARGS[target]) return ['-vn', '-map', '0:a:0?'].concat(AUDIO_ARGS[target]);
    if (VIDEO_ARGS[target]) return VIDEO_ARGS[target].slice();
    return [];
  }

  /** True when these detected files ({ext, category}) can be merged into one PDF. */
  function canMerge(infos) {
    if (!infos || infos.length < 2) return false;
    for (var i = 0; i < infos.length; i++) {
      var f = infos[i];
      if (!f || (f.category !== 'pdf' && f.category !== 'image')) return false;
    }
    return true;
  }

  /** Natural filename order: "page 2" before "page 10". */
  function compareNames(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  // ---------------------------------------------------------------- helpers
  function outputName(name, target) {
    var base = String(name).split('/').pop();
    var dot = base.lastIndexOf('.');
    return (dot > 0 ? base.slice(0, dot) : base) + '.' + target;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /** 'rtl' when most letters are Hebrew/Arabic, else 'ltr'. */
  function textDirection(text) {
    var rtl = (String(text).match(/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g) || []).length;
    var ltr = (String(text).match(/[A-Za-z\u00C0-\u024F]/g) || []).length;
    return rtl > ltr ? 'rtl' : 'ltr';
  }

  /** A clean standalone HTML page around converted content (print-ready, RTL-aware). */
  function htmlDocument(title, body) {
    var dir = textDirection(String(body).replace(/<[^>]*>/g, ' '));
    return '<!DOCTYPE html>\n<html dir="' + dir + '">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + escapeHtml(title) + '</title>\n<style>\n' +
      'body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;' +
      'max-width:760px;margin:40px auto;padding:0 20px;color:#1d1d1f}\n' +
      'table{border-collapse:collapse}td,th{border:1px solid #d2d2d7;padding:6px 10px;text-align:left}\n' +
      'th{background:#f5f5f7}pre,code{background:#f5f5f7;border-radius:6px}pre{padding:12px;overflow:auto}\n' +
      'img{max-width:100%}\n' +
      'p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,pre{unicode-bidi:plaintext;text-align:start}\n' +
      '@page{size:A4;margin:18mm}\n@media print{body{max-width:none;margin:0;padding:0}}\n' +
      '</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n';
  }

  return {
    CATEGORIES: CATEGORIES,
    LABELS: LABELS,
    MIME: MIME,
    normalizeExt: normalizeExt,
    extOf: extOf,
    sniff: sniff,
    detect: detect,
    targetsFor: targetsFor,
    ffmpegArgs: ffmpegArgs,
    MERGE_TARGET: MERGE_TARGET,
    canMerge: canMerge,
    compareNames: compareNames,
    outputName: outputName,
    escapeHtml: escapeHtml,
    textDirection: textDirection,
    htmlDocument: htmlDocument
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CONVERTER;
