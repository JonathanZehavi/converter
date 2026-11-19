#!/bin/bash
set -euo pipefail
rm -rf "$HOME/Library/Services/Convert.workflow" "$HOME/Library/Application Support/Converter"
/System/Library/CoreServices/pbs -flush >/dev/null 2>&1 || true
echo "✓ Converter removed."
