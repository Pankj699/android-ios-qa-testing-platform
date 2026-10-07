#!/usr/bin/env bash
cd "$(dirname "$0")"

echo "=================================================="
echo "      QA DEVICE AGENT - macOS Quick Start         "
echo "=================================================="

if ! command -v python3 >/dev/null 2>&1; then
    echo "[-] Python 3 is not installed. Please install Python 3."
    exit 1
fi

echo "[*] Checking and installing dependencies..."
python3 -m pip install -q -r requirements.txt 2>/dev/null || pip3 install -q pymobiledevice3 websockets requests

echo "[*] Launching QA Device Agent..."
python3 src/main.py
