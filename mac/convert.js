// Converter — Finder Quick Action engine (JavaScript for Automation, built into macOS).
//
// Invoked by Convert.workflow as:
//   osascript -l JavaScript convert.js <file> [<file> …]
//
// Engines:  ffmpeg (Homebrew) for audio/video, afconvert as audio fallback,
//           sips for images, textutil for documents, SheetJS/js-yaml for data.
// Everything runs locally. Nothing is uploaded anywhere.

ObjC.import('Foundation');

var app = Application.currentApplication();
app.includeStandardAdditions = true;

var fm = $.NSFileManager.defaultManager;
var SUPPORT = $('~/Library/Application Support/Converter').stringByExpandingTildeInPath.js;
var TITLE = 'Convert';

// ------------------------------------------------------------------ io helpers
function readText(path) {
  var s = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (s.isNil()) s = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSISOLatin1StringEncoding, null);
  if (s.isNil()) throw new Error('Cannot read ' + path);
  return s.js;
}
function writeText(path, text) {
  if (!$(text).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null)) {
    throw new Error('Cannot write ' + path);
  }
}
function readBase64(path) {
  var d = $.NSData.dataWithContentsOfFile(path);
  if (d.isNil()) throw new Error('Cannot read ' + path);
  return d.base64EncodedStringWithOptions(0).js;
}
function writeBase64(path, b64) {
  var d = $.NSData.alloc.initWithBase64EncodedStringOptions(b64, 0);
  if (!d.writeToFileAtomically(path, true)) throw new Error('Cannot write ' + path);
}
function exists(path) { return fm.fileExistsAtPath(path); }
function load(rel) { (0, eval)(readText(SUPPORT + '/' + rel)); } // eval in global scope

function q(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function sh(cmd) { return app.doShellScript(cmd, { alteringLineEndings: false }); }

var tmpDir = null;
function tmp(name) {
  if (!tmpDir) tmpDir = sh('/usr/bin/mktemp -d -t converter').trim();
  return tmpDir + '/' + name;
}

function firstBytes(path) {
  try {
    var hex = sh('/usr/bin/head -c 256 ' + q(path) + ' | /usr/bin/xxd -p | /usr/bin/tr -d "\\n"');
    var out = [];
    for (var i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
    return out;
  } catch (e) { return null; }
}

// ------------------------------------------------------------------ engines
var FFMPEG = (function () {
  var candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/local/bin/ffmpeg'];
  for (var i = 0; i < candidates.length; i++) if (exists(candidates[i])) return candidates[i];
  try {
    var p = sh('PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"; command -v ffmpeg').trim();
    if (p) return p;
  } catch (e) {}
  return null;
})();

var SIPS_FORMAT = { jpg: 'jpeg', png: 'png', tiff: 'tiff', gif: 'gif', bmp: 'bmp', heic: 'heic', pdf: 'pdf' };
var TEXTUTIL_IN = ['txt', 'html', 'rtf', 'doc', 'docx', 'odt', 'md'];
var TEXTUTIL_OUT = ['txt', 'html', 'rtf', 'doc', 'docx', 'odt'];
var VIDEO_FROM_IMAGE = ['mp4', 'webm', 'mov'];

// Built-in afconvert covers common audio when ffmpeg is missing.
var AFCONVERT = {
  m4a: ['m4af', 'aac'], aac: ['adts', 'aac'], wav: ['WAVE', 'LEI16'],
  aiff: ['AIFF', 'BEI16'], flac: ['flac', 'flac']
};
var AFCONVERT_IN = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'aiff', 'caf', 'alac', 'm4b'];

function macSupports(src, target, cat) {
  if (cat === 'document') return TEXTUTIL_IN.indexOf(src) >= 0 && TEXTUTIL_OUT.indexOf(target) >= 0;
  return true;
}

function needsFfmpeg(file, target) {
  if (file.category === 'video') return true;
  if (file.category === 'audio') return !(AFCONVERT[target] && AFCONVERT_IN.indexOf(file.ext) >= 0);
  if (file.category === 'image') return !SIPS_FORMAT[target] || VIDEO_FROM_IMAGE.indexOf(target) >= 0;
  return false;
}

function ffmpeg(input, output, args) {
  sh(q(FFMPEG) + ' -nostdin -hide_banner -loglevel error -y -i ' + q(input) + ' ' +
    args.map(q).join(' ') + ' ' + q(output));
}

function convertMedia(file, target, out) {
  if (FFMPEG) return ffmpeg(file.path, out, CONVERTER.ffmpegArgs(target, file.category));
  var a = AFCONVERT[target];
  sh('/usr/bin/afconvert -f ' + a[0] + ' -d ' + a[1] + ' ' + q(file.path) + ' ' + q(out));
}

function convertImage(file, target, out) {
  var src = file.path;
  if (file.ext === 'svg') {
    // Quick Look renders SVG to PNG.
    var dir = tmp('svg');
    sh('/bin/mkdir -p ' + q(dir) + ' && /usr/bin/qlmanage -t -s 2048 -o ' + q(dir) + ' ' + q(src) + ' >/dev/null 2>&1');
    src = dir + '/' + file.path.split('/').pop() + '.png';
    if (!exists(src)) throw new Error('Could not render the SVG');
  }
  if (VIDEO_FROM_IMAGE.indexOf(target) >= 0) return ffmpeg(src, out, CONVERTER.ffmpegArgs(target, 'image'));
  if (SIPS_FORMAT[target]) {
    var opts = target === 'jpg' || target === 'heic' ? ' -s formatOptions 90' : '';
    sh('/usr/bin/sips -s format ' + SIPS_FORMAT[target] + opts + ' ' + q(src) + ' --out ' + q(out) + ' >/dev/null');
    return;
  }
  // webp / ico: let sips decode anything ImageIO reads (HEIC, AVIF, TIFF…), then ffmpeg encodes.
  var input = src;
  if (file.ext !== 'gif' && file.ext !== 'png') {
    input = tmp('frame.png');
    sh('/usr/bin/sips -s format png ' + q(src) + ' --out ' + q(input) + ' >/dev/null');
  }
  ffmpeg(input, out, CONVERTER.ffmpegArgs(target, 'image'));
}

function convertDocument(file, target, out) {
  var src = file.path;
  var extra = '';
  if (file.ext === 'md') {
    load('shared/vendor/marked.umd.js');
    var title = file.name.replace(/\.[^.]+$/, '');
    var html = CONVERTER.htmlDocument(title, marked.parse(readText(file.path)));
    if (target === 'html') return writeText(out, html);
    src = tmp('document.html');
    writeText(src, html);
  } else if (file.ext === 'txt') {
    extra = ' -inputencoding UTF-8';
  }
  sh('/usr/bin/textutil' + extra + ' -convert ' + target + ' -output ' + q(out) + ' ' + q(src));
}

function convertTable(file, target, out) {
  if (CONVERTER_TABLE.needsYAML(file.ext, target)) load('shared/vendor/js-yaml.min.js');
  if (CONVERTER_TABLE.needsXLSX(file.ext, target)) load('shared/vendor/xlsx.full.min.js');
  var input = CONVERTER_TABLE.isBinaryInput(file.ext) ? readBase64(file.path) : readText(file.path);
  var res = CONVERTER_TABLE.convert(file.ext, input, target, file.name);
  if (res.base64) writeBase64(out, res.base64); else writeText(out, res.text);
}

function convertOne(file, target, out) {
  switch (file.category) {
    case 'video': case 'audio': return convertMedia(file, target, out);
    case 'image': return convertImage(file, target, out);
    case 'document': return convertDocument(file, target, out);
    case 'table': return convertTable(file, target, out);
  }
  throw new Error('Unsupported file');
}

// ------------------------------------------------------------------ ui helpers
function uniqueOutput(path, target) {
  var dir = path.substring(0, path.lastIndexOf('/'));
  var base = CONVERTER.outputName(path, target).replace(/\.[^.]+$/, '');
  var candidate = dir + '/' + base + '.' + target;
  for (var n = 2; exists(candidate); n++) candidate = dir + '/' + base + ' ' + n + '.' + target;
  return candidate;
}

function alert(message, detail) {
  app.activate();
  try {
    app.displayAlert(message, { message: detail || '', as: 'warning', buttons: ['OK'], defaultButton: 'OK' });
  } catch (e) {}
}

function askToInstallFfmpeg() {
  app.activate();
  try {
    var r = app.displayDialog(
      'This conversion needs FFmpeg — a free, open-source converter that runs entirely on your Mac.\n\n' +
      'Install it once in Terminal — see the README (Apple Silicon: brew install ffmpeg; Intel: static build from evermeet.cx).\n\n' +
      '(No Homebrew yet? Get it from brew.sh)',
      { withTitle: TITLE, buttons: ['Cancel', 'Copy Command'], defaultButton: 'Copy Command', withIcon: 'caution' });
    if (r.buttonReturned === 'Copy Command') app.setTheClipboardTo('brew install ffmpeg');
  } catch (e) { /* user cancelled */ }
}

function cleanup() {
  if (tmpDir) try { sh('/bin/rm -rf ' + q(tmpDir)); } catch (e) {}
}

// ------------------------------------------------------------------ main
function run(argv) {
  if (!argv || !argv.length) {
    alert('Nothing to convert', 'Select files in Finder, right-click, and choose Quick Actions → Convert.');
    return;
  }
  load('shared/formats.js');
  load('shared/table.js');

  var files = argv.map(function (path) {
    var name = path.split('/').pop();
    var info = CONVERTER.detect(name, null) || CONVERTER.detect(name, firstBytes(path));
    return { path: path, name: name, ext: info && info.ext, category: info && info.category };
  });
  var known = files.filter(function (f) { return f.category; });
  var unknown = files.filter(function (f) { return !f.category; });

  if (!known.length) {
    alert('Converter can’t convert ' + (files.length === 1 ? '“' + files[0].name + '”' : 'these files'),
      'Supported: video, audio, images, documents, spreadsheets and data files.');
    return;
  }

  // Offer only formats every selected file can become.
  var lists = known.map(function (f) {
    return CONVERTER.targetsFor(f.ext, macSupports).map(function (t) { return t.ext; });
  });
  var targets = CONVERTER.targetsFor(known[0].ext, macSupports).filter(function (t) {
    return lists.every(function (l) { return l.indexOf(t.ext) >= 0; });
  });
  if (!targets.length) {
    alert('No common format', 'These files are different kinds. Select files of the same kind (for example, only videos) and try again.');
    return;
  }

  var items = targets.map(function (t) { return t.ext.toUpperCase() + '   ·   ' + t.label; });
  var first = known[0];
  var prompt = known.length === 1
    ? 'Convert “' + first.name + '” (' + CONVERTER.CATEGORIES[first.category].label + ', ' + first.ext.toUpperCase() + ') to:'
    : 'Convert ' + known.length + ' files to:';
  if (unknown.length) prompt += '\n(' + unknown.length + ' unsupported file' + (unknown.length > 1 ? 's' : '') + ' will be skipped)';

  app.activate();
  var choice = app.chooseFromList(items, {
    withTitle: TITLE, withPrompt: prompt, defaultItems: [items[0]],
    okButtonName: 'Convert', cancelButtonName: 'Cancel'
  });
  if (!choice) return;
  var target = targets[items.indexOf(choice[0])].ext;

  if (!FFMPEG && known.some(function (f) { return needsFfmpeg(f, target); })) {
    askToInstallFfmpeg();
    return;
  }

  var done = [], failed = [];
  try {
    known.forEach(function (f) {
      var out = uniqueOutput(f.path, target);
      try {
        convertOne(f, target, out);
        if (!exists(out)) throw new Error('No output was produced');
        done.push(out);
      } catch (e) {
        if (exists(out)) fm.removeItemAtPathError(out, null);
        failed.push(f.name + ': ' + String(e.message || e).split('\n')[0].slice(0, 200));
      }
    });
  } finally {
    cleanup();
  }

  if (failed.length) {
    alert(done.length ? 'Some files could not be converted' : 'Conversion failed', failed.join('\n'));
  }
  if (done.length) {
    app.displayNotification(
      done.length === 1 ? done[0].split('/').pop() : done.length + ' files converted to ' + target.toUpperCase(),
      { withTitle: 'Converted', soundName: 'Glass' });
    if (done.length === 1) sh('/usr/bin/open -R ' + q(done[0]));
  }
}
