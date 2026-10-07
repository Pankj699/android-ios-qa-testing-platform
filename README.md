# Android Play Asset Delivery (PAD) & ORD QA Testing Platform

A production-ready, full-stack web application that allows QA engineers to perform Android **Play Asset Delivery (PAD)** and **On-Demand Resources (ORD)** testing from an intuitive browser dashboard.

The platform executes all ADB, Java JDK, and Bundletool operations on the controlled host/backend server while providing a responsive web interface with real-time logcat streaming, step-by-step pipeline monitoring, and automated PASS/FAIL verification.

---

## 1. Project Overview

Traditionally, QA engineers had to manually configure PowerShell scripts, edit hardcoded `.aab` paths, configure device IP addresses, run Bundletool commands, and parse raw terminal output to verify Play Asset Delivery.

This platform automates that entire process:
- **No Terminal Required for QA**: Pair devices, upload AABs, run tests, and monitor logs directly from the web browser.
- **Wireless Debugging**: Connect Android 11+ physical devices over Wi-Fi with IP/Port reachability validation.
- **AAB Deep Inspection**: Automatically extracts Package Name, Version Name/Code, Target/Min SDK, and individual Asset Packs with their delivery modes (`fast-follow`, `install-time`, `on-demand`).
- **Bundletool Local Testing Automation**: Generates test APKs with `--local-testing` and installs them onto target devices.
- **Live Logcat Streaming via WebSockets**: Real-time parsing of `AssetPackHelper`, `PlayCore`, and `PlayAssetDelivery` tags with download progress bars (0% → 100%).
- **Controlled ADB Operations & Safe Console**: Predefined operations (Launch, Clear Data, Uninstall, Logcat Buffer Clear) and allowlisted command execution with zero arbitrary remote shell exposure.
- **Persistent Test History**: View past runs, exportable summaries, and downloadable logs.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Browser (Frontend)                   │
│  - React 18 + Vite + Tailwind CSS                           │
│  - Wireless Debugging Pairing & Connection Wizard           │
│  - Drag & Drop AAB Upload & Manifest / Asset Pack Inspector │
│  - Live WebSocket PAD Test Console & Logcat Streamer        │
│  - Test History, Reports & Controlled ADB Console           │
└──────────────────────────────┬──────────────────────────────┘
                               │ REST APIs + WebSockets (ws://)
┌──────────────────────────────▼──────────────────────────────┐
│                  Backend Service (Node.js/Express)          │
│  - Network Reachability Validator (IP/Port socket test)     │
│  - Device Manager & Wireless Debugging (adb pair / connect) │
│  - AAB Analyzer & Bundletool Local Testing Service          │
│  - PAD Test Pipeline Engine & Logcat Tag Monitor            │
│  - Secure Allowlisted ADB Operations Service                │
│  - Persistent Test History & Diagnostics Engine             │
└──────────────────────────────┬──────────────────────────────┘
                               │ Controlled Process Spawning
┌──────────────────────────────▼──────────────────────────────┐
│               Host Environment Tools & Devices              │
│  - Android Platform Tools (adb.exe)                         │
│  - Java JDK Runtime (java.exe)                              │
│  - Bundletool (bundletool-all-1.18.3.jar)                   │
│  - Connected Android Physical Devices (Wi-Fi / USB)         │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Requirements

* **Node.js**: v18.0.0 or higher
* **Java JDK**: JDK 11 or higher (`java -version`)
* **Android Platform Tools**: ADB installed and in system PATH (`adb version`)
* **Bundletool**: `bundletool-all-1.18.3.jar` (automatically managed by the backend or placed in `backend/tools/`)
* **Android Device**: Android 11+ with Wireless Debugging enabled (or Android 7+ via USB)

---

## 4. Installation & Setup

### Clone and Install Dependencies
```bash
# Clone the repository
git clone <repository_url>
cd "ODR Test"

# Install root, backend, and frontend dependencies
npm run install:all
```

---

## 5. ADB Setup

Ensure Android Debug Bridge (ADB) is installed on the host machine:
- **Windows**: Install [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools) and add `C:\platform-tools` to your system `PATH`.
- **Linux/macOS**: `sudo apt install android-tools-adb` or `brew install android-platform-tools`
- Verify in terminal:
  ```bash
  adb version
  ```

---

## 6. Bundletool Setup

The platform uses `bundletool-all-1.18.3.jar` for local testing APK generation.
- Place `bundletool-all-1.18.3.jar` in `backend/tools/` (the platform will also auto-download it on first run if missing).
- Or specify a custom path in `.env`:
  ```env
  BUNDLETOOL_PATH=C:/path/to/bundletool-all-1.18.3.jar
  ```

---

## 7. Java Setup

A Java JDK (11 or higher) is required by Bundletool.
- **Windows**: Install Eclipse Temurin / Oracle JDK / OpenJDK.
- Verify in terminal:
  ```bash
  java -version
  ```

---

## 8. Environment Variables

Create a `.env` file in the root or `backend/` directory (see `.env.example`):

```env
PORT=3000
NODE_ENV=production
ADB_PATH=adb
JAVA_PATH=java
BUNDLETOOL_PATH=./backend/tools/bundletool-all-1.18.3.jar
UPLOAD_DIR=./backend/uploads
LOG_DIR=./backend/logs
DATA_DIR=./backend/data
MAX_AAB_SIZE_MB=1024
TEST_TIMEOUT_MS=600000
ADB_TIMEOUT_MS=30000
CORS_ORIGIN=*
IS_INTERNAL_QA=true
```

---

## 9. Running Locally

### Option A: One-Click Windows Batch Launcher
Double-click `run-qa-test.bat` in the project root.

### Option B: Node Scripts
```bash
# Build frontend assets
npm run build:frontend

# Start production server
npm start
```
Then open your browser at **`http://localhost:3000`**.

### Option C: Development Mode (Hot Reload)
```bash
npm run dev
```
- Backend runs on `http://localhost:3000`
- Frontend Vite dev server runs on `http://localhost:5173`

---

## 10. Pairing Android Device (Wireless Debugging)

1. On your Android device:
   - Navigate to **Settings → System → Developer Options → Wireless Debugging**.
   - Turn Wireless Debugging **ON**.
   - Tap **"Pair device with pairing code"**.
2. On the Web Dashboard:
   - Click **Connect Device** or open **Devices** page.
   - Enter:
     - **Device IP** (e.g. `192.168.1.105`)
     - **Pairing Port** (e.g. `37129`)
     - **6-Digit Pairing Code** (e.g. `842109`)
   - Click **Pair Device**.
3. After pairing succeeds:
   - Note the **Connection Port** displayed on the main Wireless Debugging screen (e.g. `41235`).
   - Enter the port and click **Connect Device**.
4. The dashboard will display the device card with battery, storage, and Android OS telemetry.

---

## 11. Uploading AAB

1. Open **Builds & AAB** or click **Upload Latest Build** on the Dashboard.
2. Drag & drop your `.aab` file or browse your computer.
3. The server validates the format, stores it securely, and analyzes:
   - **Application Name**
   - **Package ID**
   - **Version Name & Code**
   - **Target SDK & Min SDK**
   - **Asset Packs**: names, delivery modes (`fast-follow`, `install-time`, `on-demand`), and sizes.

---

## 12. Running PAD Test

1. Navigate to **Run PAD Test**.
2. Select your target **Connected Device** and **Uploaded AAB Build**.
3. Choose your **Installation Mode**:
   - **Fresh Install**: Checks if the app exists and prompts for uninstallation to ensure clean baseline testing.
   - **Update Existing App**: Updates the package while preserving existing app data.
4. Click **[ ▶ Run PAD Test ]**.
5. The live execution console will step through:
   - `[✓] Checking Prerequisites (Java, ADB, Bundletool)`
   - `[✓] Validating Connected Android Device`
   - `[✓] Analyzing AAB and Asset Packs`
   - `[✓] Handling Install Mode`
   - `[✓] Generating APKs with Bundletool Local Testing (--local-testing)`
   - `[✓] Installing Generated Application`
   - `[✓] Launching Application (monkey / am start)`
   - `[✓] Monitoring AssetPackHelper & Download Status`
   - `[✓] Final PAD Verification & Result Analysis`
6. Watch the real-time Asset Pack progress bar (0% → 100%) and color-coded live logs.
7. Upon completion, a **PASS / FAIL** modal presents full results, timeline, and downloadable logs.

---

## 13. Standalone PowerShell Workflow

QA engineers can also execute the workflow directly in PowerShell:
```powershell
.\scripts\qa-test-asset-delivery.ps1 -AabPath "path/to/app.aab" -DeviceSerial "192.168.1.105:41235" -InstallMode "Fresh"
```

---

## 14. Troubleshooting

| Error / Issue | Probable Cause | Action |
| :--- | :--- | :--- |
| **"Device is not reachable from the QA server"** | Device and QA host are on different networks or Wi-Fi AP has client isolation enabled. | Ensure both QA server and Android device are on the same Wi-Fi subnet without client isolation. |
| **"Pairing failed: Invalid pairing code or expired port"** | Android pairing ports rotate every time the pairing dialog closes. | Keep the pairing dialog open on the device while clicking [Pair Device]. |
| **"ADB was not found at 'adb'"** | ADB is not in system PATH. | Set `ADB_PATH` in `.env` to the exact path of `adb.exe`. |
| **"Java JDK was not found"** | Java is not installed or configured. | Install JDK 11+ and ensure `java` is accessible in PATH. |
| **"INSTALL_FAILED_VERSION_DOWNGRADE"** | An existing build has a higher version code. | Select **Fresh Install** mode. |

---

## 15. Security & Controlled Execution

* **No Arbitrary Remote Shell**: The backend strictly validates and allowlists all ADB operations. It does not accept arbitrary shell commands.
* **Input Sanitization**: All file uploads, serial strings, and command parameters are sanitized server-side.
* **Restricted Uploads**: Upload directory is private and only `.aab` files up to configured size limits are accepted.
* **Internal QA Deployment**: Designed for trusted QA environments and local testing subnets.

---

## 16. Docker Deployment

A multi-stage `Dockerfile` and `docker-compose.yml` are provided.

```bash
docker-compose up --build -d
```

> **Important**: Docker uses `network_mode: "host"` so ADB can discover and communicate with Android physical devices on the host's local network.

---

## 17. License

MIT License. Built for Android QA and Release Engineering Teams.
