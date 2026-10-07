#!/usr/bin/env bash
# Automated macOS Application Bundle & DMG Builder for QA Device Agent
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_DIR="$DIST_DIR/QA Device Agent.app"

echo "=================================================="
echo "      QA DEVICE AGENT - macOS BUILD PIPELINE      "
echo "=================================================="

# 1. Clean previous build
rm -rf "$DIST_DIR/QA Device Agent.app" "$DIST_DIR"/*.dmg

# 2. Build via PyInstaller
python3 -m PyInstaller --noconfirm --clean "$ROOT_DIR/qa_device_agent.spec"

# 3. Create .app bundle structure
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# Copy binary & dependencies
cp -R "$DIST_DIR/qa-device-agent/"* "$APP_DIR/Contents/MacOS/"
cp "$ROOT_DIR/package/macos/Info.plist" "$APP_DIR/Contents/Info.plist"
chmod +x "$APP_DIR/Contents/MacOS/qa-device-agent"

echo "[+] Application bundle created at: $APP_DIR"

# 4. Optional DMG creation if hdiutil is present
if command -v hdiutil >/dev/null 2>&1; then
    DMG_PATH="$DIST_DIR/QA-Device-Agent-macOS-v1.1.2.dmg"
    hdiutil create -volname "QA Device Agent" -srcfolder "$APP_DIR" -ov -format UDZO "$DMG_PATH"
    echo "[+] Disk image created at: $DMG_PATH"
fi
