# Converter

Convert video, audio, images, documents and spreadsheets **on your own device**: no uploads, no sketchy websites.
The file type is detected automatically, and you only see the formats it can actually become.

Two front-ends share one engine (`shared/`):

| | Where | How |
|---|---|---|
| **Mac Quick Action** | Finder → right-click → **Quick Actions → Convert…** | native dialog, output saved next to the original |
| **Website** | `web/` (works on desktop and phone) | everything runs in the browser, nothing is uploaded |

## Mac Quick Action

```bash
git clone https://github.com/JonathanZehavi/converter.git
cd converter
./mac/install.sh
brew install ffmpeg      # Apple Silicon: needed for video and most audio (AVI→MP4, FLAC→MP3 …)
```

**Intel Mac?** Homebrew no longer supports Intel, so install a static FFmpeg build instead:

```bash
curl -L -o /tmp/ffmpeg.zip https://evermeet.cx/ffmpeg/getrelease/zip
unzip -o /tmp/ffmpeg.zip -d /tmp
sudo mkdir -p /usr/local/bin && sudo mv /tmp/ffmpeg /usr/local/bin/
ffmpeg -version
```

Then right-click any file in Finder → **Quick Actions → Convert…**, pick a format, and the converted file appears next to the original.

* If it doesn't show up, open **System Settings → General → Login Items & Extensions → Finder** (older macOS: *Privacy & Security → Extensions → Finder*) and enable **Convert…**.
* The first time you convert a file in Desktop/Documents/Downloads, macOS may ask for permission. Allow it.
* Remove it with `./mac/uninstall.sh`.

Engines on the Mac: `ffmpeg` for audio/video (with Apple's `afconvert` as a fallback for M4A/WAV/AIFF/FLAC), `sips` for images, `textutil` for documents, and SheetJS/js-yaml for data.

## Website

Static files, no build step. Locally:

```bash
python3 -m http.server 8000   # then open http://localhost:8000/web/
```

To publish: **Settings → Pages → Source: GitHub Actions**. The included workflow deploys on every push to `main`.

Audio/video run on [ffmpeg.wasm](https://ffmpegwasm.netlify.app/). The ~30 MB engine is downloaded once from jsDelivr and cached; your files never leave the browser.

## Supported formats

| Kind | Opens | Saves as |
|---|---|---|
| Video | mp4 m4v mov avi mkv webm wmv flv mpg ts mts m2ts 3gp ogv vob | mp4 mov mkv webm avi gif · audio: mp3 m4a wav flac ogg opus |
| Audio | mp3 wav flac m4a aac ogg opus aiff wma caf amr ac3 alac m4b | mp3 m4a wav flac ogg opus aiff aac |
| Image | jpg png gif webp heic avif bmp tiff ico svg | jpg png webp gif tiff bmp ico pdf · heic (Mac only) · animated GIF → mp4/webm/mov |
| Document | docx doc odt rtf html md txt | Mac: docx doc odt rtf html txt · Web: html txt (from docx/md/html/txt) |
| Data & Sheets | xlsx xls ods csv tsv json yaml | xlsx ods csv tsv json yaml html |

## Known limits

* Converting only works within a family. A video can't become a Word document.
* In the browser, very large videos (over ~1–2 GB, less on iPhone) can run out of memory. Use the Mac Quick Action for those.
* HEIC photos open in the browser only on Safari.
* PDF is an output for images only. Reading or editing PDFs is out of scope.

## Layout

```
shared/formats.js   format registry, detection (extension + magic bytes), ffmpeg presets — used by both
shared/table.js     csv/tsv/json/yaml/xlsx/ods engine — used by both
mac/                Quick Action (Convert.workflow), JXA engine (convert.js), install/uninstall
web/                the website (index.html, styles.css, app.js, engine.js)
```
