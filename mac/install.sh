#!/bin/bash
# Installs the "Convert…" Finder Quick Action for the current user.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUPPORT="$HOME/Library/Application Support/Converter"
SERVICES="$HOME/Library/Services"

echo "Installing Converter…"
mkdir -p "$SUPPORT/shared/vendor" "$SERVICES"
cp "$ROOT/mac/convert.js" "$SUPPORT/"
cp "$ROOT/shared/formats.js" "$ROOT/shared/table.js" "$SUPPORT/shared/"
cp "$ROOT/shared/vendor/"*.js "$SUPPORT/shared/vendor/"

rm -rf "$SERVICES/Convert.workflow"
cp -R "$ROOT/mac/Convert.workflow" "$SERVICES/"

# Files downloaded from the internet are quarantined; clear that so macOS will run them.
xattr -dr com.apple.quarantine "$SERVICES/Convert.workflow" "$SUPPORT" 2>/dev/null || true

# Refresh the Services menu so the Quick Action shows up right away.
/System/Library/CoreServices/pbs -flush >/dev/null 2>&1 || true
/System/Library/CoreServices/pbs -update >/dev/null 2>&1 || true

echo "✓ Installed. In Finder: right-click any file → Quick Actions → Convert…"

if ! command -v ffmpeg >/dev/null 2>&1 && [ ! -x /opt/homebrew/bin/ffmpeg ] && [ ! -x /usr/local/bin/ffmpeg ]; then
  echo
  echo "Images, documents and spreadsheets work now."
  echo "For video and most audio (AVI→MP4, FLAC→MP3…) install FFmpeg once:"
  if [ "$(uname -m)" = "arm64" ]; then
    echo "    brew install ffmpeg"
  else
    echo "    (Intel Mac — Homebrew no longer supports it)"
    echo "    1. In a browser, download the ffmpeg zip from https://evermeet.cx/ffmpeg/ and unzip it"
    echo "    2. sudo mkdir -p /usr/local/bin && sudo mv ~/Downloads/ffmpeg /usr/local/bin/"
    echo "    3. xattr -d com.apple.quarantine /usr/local/bin/ffmpeg"
  fi
fi
