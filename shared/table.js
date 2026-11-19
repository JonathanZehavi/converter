/*
 * Converter — shared data / spreadsheet engine.
 *
 * Pure JavaScript, used by both the web app and the Mac Quick Action.
 * Needs the globals `jsyaml` (for YAML) and `XLSX` (SheetJS, for xlsx/xls/ods) when
 * those formats are involved. Defines a single global: CONVERTER_TABLE.
 *
 * Input:  text (csv/tsv/json/yaml) or base64 (xlsx/xls/ods).
 * Output: { text } or { base64 }.
 */
var CONVERTER_TABLE = (function () {
  'use strict';

  var BINARY_IN = { xlsx: 1, xls: 1, ods: 1 };
  var BINARY_OUT = { xlsx: 1, ods: 1 };

  function isBinaryInput(ext) { return !!BINARY_IN[ext]; }
  function isBinaryOutput(ext) { return !!BINARY_OUT[ext]; }
  function needsXLSX(src, target) { return !!(BINARY_IN[src] || BINARY_OUT[target]); }

  function stripBom(s) { return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }

  // ------------------------------------------------------------ delimited text
  function guessDelimiter(text) {
    var line = text.split(/\r?\n/)[0] || '';
    var best = ',', bestCount = 0;
    [',', ';', '\t', '|'].forEach(function (d) {
      var n = line.split(d).length - 1;
      if (n > bestCount) { best = d; bestCount = n; }
    });
    return best;
  }

  function parseDelimited(text, delim) {
    text = stripBom(text);
    var rows = [], row = [], field = '', inQuotes = false, fieldStart = true;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += c;
      } else if (c === '"' && fieldStart) {
        inQuotes = true; fieldStart = false;
      } else if (c === delim) {
        row.push(field); field = ''; fieldStart = true;
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = ''; fieldStart = true;
      } else {
        field += c; fieldStart = false;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return !(r.length === 1 && r[0] === ''); });
  }

  function coerce(v) {
    if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(v) && v.length < 16) return Number(v);
    if (v === 'true') return true;
    if (v === 'false') return false;
    return v;
  }

  function rowsToRecords(rows) {
    if (!rows.length) return [];
    var seen = {};
    var header = rows[0].map(function (h, i) {
      var name = String(h).trim() || 'column_' + (i + 1);
      while (seen[name]) name += '_';
      seen[name] = true;
      return name;
    });
    return rows.slice(1).map(function (r) {
      var o = {};
      header.forEach(function (h, i) { o[h] = coerce(r[i] === undefined ? '' : r[i]); });
      return o;
    });
  }

  function cellText(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return isNaN(v) ? '' : v.toISOString();
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  function toDelimited(records, columns, delim) {
    function esc(v) {
      var s = cellText(v);
      return (s.indexOf(delim) >= 0 || /["\r\n]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = [columns.map(esc).join(delim)];
    records.forEach(function (r) {
      lines.push(columns.map(function (c) { return esc(r[c]); }).join(delim));
    });
    return lines.join('\n') + '\n';
  }

  // ------------------------------------------------------------ shaping
  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
  }

  function flatten(obj, prefix, out) {
    out = out || {};
    Object.keys(obj).forEach(function (k) {
      var key = prefix ? prefix + '.' + k : k;
      var v = obj[k];
      if (isPlainObject(v) && Object.keys(v).length) flatten(v, key, out);
      else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
    });
    return out;
  }

  /** Turn arbitrary JSON/YAML data into flat records (array of objects). */
  function toRecords(data) {
    if (Array.isArray(data)) {
      if (data.length && data.every(Array.isArray)) {
        return rowsToRecords(data.map(function (r) { return r.map(cellText); }));
      }
      return data.map(function (item) {
        return isPlainObject(item) ? flatten(item) : { value: item };
      });
    }
    if (isPlainObject(data)) {
      var keys = Object.keys(data);
      if (keys.length === 1 && Array.isArray(data[keys[0]])) return toRecords(data[keys[0]]);
      return [flatten(data)];
    }
    return [{ value: data }];
  }

  function columnsOf(records) {
    var cols = [], seen = {};
    records.forEach(function (r) {
      Object.keys(r).forEach(function (k) { if (!seen[k]) { seen[k] = true; cols.push(k); } });
    });
    return cols;
  }

  // ------------------------------------------------------------ parse
  function parse(ext, input) {
    switch (ext) {
      case 'csv': return { data: rowsToRecords(parseDelimited(input, guessDelimiter(stripBom(input)))) };
      case 'tsv': return { data: rowsToRecords(parseDelimited(input, '\t')) };
      case 'json': return { data: JSON.parse(stripBom(input)) };
      case 'yaml': return { data: jsyaml.load(stripBom(input)) };
      case 'xlsx': case 'xls': case 'ods': {
        var wb = XLSX.read(input, { type: 'base64', cellDates: true });
        var sheets = wb.SheetNames.map(function (n) {
          return { name: n, records: XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: true }) };
        });
        return { wb: wb, sheets: sheets };
      }
    }
    throw new Error('Unsupported data format: ' + ext);
  }

  function sheetsOf(parsed) {
    if (parsed.sheets) return parsed.sheets;
    return [{ name: 'Sheet1', records: toRecords(parsed.data) }];
  }

  function plainData(parsed) {
    if (!parsed.sheets) return parsed.data;
    if (parsed.sheets.length === 1) return parsed.sheets[0].records;
    var o = {};
    parsed.sheets.forEach(function (s) { o[s.name] = s.records; });
    return o;
  }

  function htmlTables(sheets) {
    var esc = typeof CONVERTER !== 'undefined' ? CONVERTER.escapeHtml : function (s) { return s; };
    return sheets.map(function (s) {
      var cols = columnsOf(s.records);
      var head = '<tr>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr>';
      var body = s.records.map(function (r) {
        return '<tr>' + cols.map(function (c) { return '<td>' + esc(cellText(r[c])) + '</td>'; }).join('') + '</tr>';
      }).join('\n');
      return (sheets.length > 1 ? '<h2>' + esc(s.name) + '</h2>\n' : '') + '<table>\n' + head + '\n' + body + '\n</table>';
    }).join('\n');
  }

  // ------------------------------------------------------------ convert
  function convert(ext, input, target, title) {
    var parsed = parse(ext, input);
    switch (target) {
      case 'json':
        return { text: JSON.stringify(plainData(parsed), null, 2) + '\n' };
      case 'yaml':
        return { text: jsyaml.dump(plainData(parsed), { noRefs: true, lineWidth: -1 }) };
      case 'csv': case 'tsv': {
        var recs = sheetsOf(parsed)[0].records;
        var text = toDelimited(recs, columnsOf(recs), target === 'csv' ? ',' : '\t');
        // BOM so Excel opens UTF-8 (Hebrew, emoji, …) correctly.
        return { text: (target === 'csv' ? '﻿' : '') + text };
      }
      case 'html': {
        var page = typeof CONVERTER !== 'undefined'
          ? CONVERTER.htmlDocument(title || 'Table', htmlTables(sheetsOf(parsed)))
          : htmlTables(sheetsOf(parsed));
        return { text: page };
      }
      case 'xlsx': case 'ods': {
        var wb = parsed.wb;
        if (!wb) {
          wb = XLSX.utils.book_new();
          sheetsOf(parsed).forEach(function (s) {
            var ws = XLSX.utils.json_to_sheet(s.records, { header: columnsOf(s.records) });
            XLSX.utils.book_append_sheet(wb, ws, String(s.name).slice(0, 31) || 'Sheet1');
          });
        }
        return { base64: XLSX.write(wb, { bookType: target, type: 'base64' }) };
      }
    }
    throw new Error('Cannot convert ' + ext + ' to ' + target);
  }

  return {
    isBinaryInput: isBinaryInput,
    isBinaryOutput: isBinaryOutput,
    needsXLSX: needsXLSX,
    needsYAML: function (src, target) { return src === 'yaml' || target === 'yaml'; },
    parseDelimited: parseDelimited,
    toRecords: toRecords,
    convert: convert
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CONVERTER_TABLE;
