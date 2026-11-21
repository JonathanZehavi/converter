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

# Build the native helpers with the Xcode Command Line Tools:
#   ConvertPicker  the "Convert to…" window (falls back to a plain dialog without it)
#   DocTool        documents → PDF and PDF → Word / RTF / text / images
build() {
  local name="$1" source="$2"
  rm -f "$SUPPORT/$name"
  echo "Building $name (takes up to a minute)…"
  if xcrun swiftc -O "$source" -o "$SUPPORT/$name" 2>"$SUPPORT/build-$name.log"; then
    echo "✓ $name built"
  else
    rm -f "$SUPPORT/$name"
    echo "⚠ Could not build $name. Errors:"
    grep -m 15 "error:" "$SUPPORT/build-$name.log" || tail -n 15 "$SUPPORT/build-$name.log"
  fi
}
if xcrun --find swiftc >/dev/null 2>&1; then
  build ConvertPicker "$ROOT/mac/picker/main.swift"
  build DocTool "$ROOT/mac/doctool/main.swift"
else
  echo "⚠ Swift compiler not found — install it with: xcode-select --install"
  echo "  (without it: basic dialog, and no PDF conversions)"
fi

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
    echo "    (Intel Mac — Homebrew no longer supports it) see \"Intel Mac?\" in README.md"
  fi
fi
