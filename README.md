# Android & iOS QA Web Testing Platform (PAD / ORD)

A production-ready, full-stack web platform for QA and mobile engineering teams to manage devices, run Android **Play Asset Delivery (PAD)** and **On-Demand Resources (ORD)** tests, inspect network traffic, mirror displays, and administer users from a unified web interface.

The platform executes all ADB, bundletool, iOS device agent, and Java JDK operations via a secure backend server while providing an interactive React interface with real-time logcat streaming, WebSockets, WebUSB, and role-based access control.

---

## 1. Project Overview

Traditionally, mobile QA engineers had to juggle terminal scripts, manual ADB pairing, complex bundletool parameters, and local proxy setups. This platform centralizes and automates the entire mobile testing lifecycle:

- **No Terminal Required for QA**: Pair and connect devices, upload builds, execute PAD tests, and stream device displays directly from the browser.
- **Multi-Transport Device Connectivity**: Supports Android USB, Android Wireless ADB (manual & QR pairing), in-browser WebUSB, and remote iOS companion agents.
- **Connection Ownership & Multi-User Isolation**: Devices connected by a user are isolated to that user and system administrators, with physical hardware identity mapping across rotating Wi-Fi ports.
- **Play Asset Delivery (PAD) Pipeline**: Automatically parses AABs, generates `--local-testing` APK sets, installs apps, launches targets, monitors asset pack downloads (0% → 100%), and validates pass/fail criteria.
- **Live Screen Mirroring**: Low-latency H.264 video streaming with touch/swipe controls and keyboard input.
- **API & HTTP Inspector**: Integrated network traffic interception with request/response inspection, filtering, and mock rules.
- **Native Authentication & User Management**: Secure server-side sessions, password reset, Remember Me, independent password visibility toggles, and an administrative user management dashboard.
- **Clean Deprecation of Legacy Claim/Release**: Obsolete device claim/release endpoints return HTTP 410 Gone; access is governed strictly by connection ownership.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Web Browser (Frontend)                         │
│  - React 18 + Vite + Tailwind CSS                                       │
│  - Device Dashboard & Wireless QR Pairing Wizard                        │
│  - WebUSB Direct Device Transport (WebADB)                              │
│  - Live Screen Mirroring (H.264 / JMuxer / WebSockets)                  │
│  - Drag & Drop AAB/APK Upload & Asset Pack Inspector                    │
│  - Real-time PAD Execution Console & Logcat Streamer                    │
│  - API / HTTP Traffic Inspector & Mock Rules                            │
│  - Admin User Management Dashboard & Native Auth Modals                 │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ HTTPS / WSS (Cookie: qa_session)
┌────────────────────────────────────▼────────────────────────────────────┐
│                    Backend Server (Node.js / Express)                   │
│  - Authentication & Session Service (bcrypt, persistent pg-mem / pg)     │
│  - RBAC Middleware (ADMIN, EDITOR, TESTER, DEVELOPER, VIEWER)           │
│  - Admin Management API & Audit Logger                                  │
│  - Device Connection Ownership & Hardware Mapping Service               │
│  - Wireless Debugging & AOSP QR Pairing Engine                          │
│  - Bundletool Local Testing & APK Generation Pipeline                   │
│  - Screen Mirror Service & WebSocket Multiplexer                        │
│  - QA Device Agent WebSocket Gateway (iOS companion agents)            │
│  - HTTP Traffic Proxy & Interceptor Engine                              │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Controlled Subprocesses & Hardware
┌────────────────────────────────────▼────────────────────────────────────┐
│                      Host Environment & Connected Devices               │
│  - Android Platform Tools (adb.exe)                                     │
│  - Java JDK 11+ Runtime                                                 │
│  - Bundletool (bundletool-all-1.18.3.jar)                               │
│  - Physical Android Devices (USB & Wi-Fi)                               │
│  - Physical iOS Devices (via QA Device Agent companion)                 │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Authentication & User Management

### Native Authentication
- **Registration**: Email and password registration (minimum 8 characters, requiring uppercase, lowercase, number, and special character). Default role assigned is `TESTER`.
- **Sessions**: Secure, server-side sessions stored in database and referenced via HttpOnly, SameSite `qa_session` cookies.
- **Offline Persistence**: In local/offline mode (without external PostgreSQL `DATABASE_URL`), an internal persistent file-backed PostgreSQL engine (`pg-mem`) automatically saves and restores users and active sessions across server restarts (`backend/data/auth_db.json`).
- **Password Reset**: Cryptographic single-use reset tokens with SHA-256 storage and expiration.
- **UI Enhancements**:
  - Independent password visibility toggles (eye icons) on Sign In, Registration, and Password Reset forms.
  - W3C standard browser credential autocomplete attributes (`username`, `current-password`, `new-password`).
  - Secure "Remember me" on Sign In that stores only the email in local storage (passwords are never saved in browser storage).

### Roles & Authorization (RBAC)
The platform enforces 5 distinct roles:
1. **ADMIN**: Full system access, User Management dashboard, force-release, view all devices and tests.
2. **EDITOR**: Create/edit test suites, run tests, manage builds.
3. **TESTER**: Connect devices, run tests, view assigned reports.
4. **DEVELOPER**: View devices, inspect logs, run diagnostic commands.
5. **VIEWER**: Read-only access to test reports and dashboards.

### Admin User Management
Accessible to users with the `ADMIN` role via the sidebar navigation:
- **User Directory**: Search by name/email, filter by role and status (`ACTIVE` / `INACTIVE`).
- **Profile Updates**: Update user names, promote/demote roles, and activate/deactivate accounts.
- **Immediate Invalidation**: Deactivating a user or resetting their password revokes all active sessions immediately.
- **Admin Safeguards**: The system prevents demoting or deactivating the last remaining active administrator.
- **Administrative Password Reset**: Set custom temporary passwords or generate cryptographically secure temporary passwords.
- **Audit Logging**: All administrative updates and password resets are recorded in the system audit log.
- **CLI Bootstrapper**: Initialize or reset the administrator account via:
  ```bash
  npm run bootstrap:admin
  ```

---

## 4. Device Connectivity & Transport

The platform supports 4 distinct device connection mechanisms:

### 1. Android USB
- Automatically detected via server-side ADB.
- **Authoritative Priority**: USB connections take priority over wireless transports for the same physical device.

### 2. Android Wireless ADB
- **Manual Pairing & Connect**: Connect via IP, pairing port, and 6-digit code for Android 11+ devices.
- **QR Code Pairing**: Displays an AOSP standard `WIFI:T:ADB` QR code. The user scans the code in Android Developer Options; mDNS discovery automatically detects the pairing service and connects.

### 3. Browser WebUSB (WebADB)
- Connect Android devices directly through Chrome/Edge WebUSB API without host ADB daemon involvement.
- Provides fallback direct device communication in restricted container or cloud deployments.

### 4. QA Device Agent (iOS Support)
- Lightweight companion agent (`qa-device-agent`) running on macOS/Windows host machines with connected iOS devices.
- Connects to the backend via authenticated WebSockets (`/api/agent/ws`), reporting connected iOS devices and streaming screen mirroring frames.

---

## 5. Device Isolation & Connection Ownership

Device isolation is managed by **Connection Ownership**:
- **Ownership Model**: When a user connects or pairs a device, connection ownership is assigned to that user (`ownership.set(serial, owner)`).
- **Multi-User Isolation**: Devices connected by a user are accessible only to that user and system administrators. Other testers cannot run tests or open mirrors on another user's device.
- **Hardware Identity Resolution**: Devices are mapped by their physical hardware serial (`devices_hardware_map.json`). Rotating dynamic Wi-Fi ports or reconnections preserve ownership identity.
- **Redundant Transport Cleanup**: When a physical device is plugged in via USB while already connected wirelessly, the redundant wireless transport is safely torn down (or deferred if a test is actively executing).
- **Claim/Release System Deprecated**: The legacy device Claim/Release system has been cleanly removed:
  - `POST /api/device/:id/claim` and `POST /api/device/:id/release` return **HTTP 410 Gone** with code `CLAIM_RELEASE_DEPRECATED`.
  - Frontend device cards no longer show claim/release buttons or claim badges.
  - Access is governed purely by connection ownership and role permissions.

---

## 6. Requirements

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

## 13. Screen Mirroring & Remote Interaction

- **Low-Latency Streaming**: Video stream rendered via JMuxer (H.264 video feed over WebSocket).
- **Interactive Remote Touch**: Click, drag, swipe, and long-press inputs translated to physical device coordinates.
- **Hardware Controls**: Navigation bar triggers Back, Home, App Switch, Power, and Volume buttons.
- **Authorization Scoped**: Mirror sessions and WebSocket stream tokens are restricted to the device owner and administrators.

---

## 14. API & HTTP Traffic Inspector

- **Network Interception**: Integrated HTTP proxy capture for app network calls.
- **Request/Response Inspection**: View status codes, latency, request/response headers, and JSON bodies.
- **Mocking & Fault Injection**: Configure mock response rules, latency delays, and error simulation (HTTP 500/403) for failure testing.

---

## 15. Testing & Verification

The platform maintains an automated test suite across all critical systems:

### Backend Test Suites
```bash
cd backend
npm test
```
- **19 Full Test Suites (299 tests)**: Covers Native Auth, Transport Lifecycle, USB Priority, QR Pairing Lifecycle, Stale Handover, Multi-User Isolation, Device Claim Deprecation, and Security Hardening. **Status: 100% PASS**.
- **Admin Management Suite** (`tests/adminUserManagement.test.js`, 26 tests): Covers RBAC authorization, user CRUD, admin password resets, deactivation, and safeguard rules. **Status: 100% PASS**.

### Frontend Production Build
```bash
cd frontend
npm run build
```
Builds cleanly with zero errors via Vite.

---

## 16. Security Considerations

- **No Remote Shell Execution**: Arbitrary shell commands are rejected; all ADB operations use strict allowlists and argument validation.
- **Token Sanitization**: System audit logs automatically scrub sensitive credentials, passwords, JWTs, and agent tokens before persisting.
- **Brute-Force & Header Protection**: Express middleware uses `helmet` headers, CORS protection, and rate limiting.
- **HttpOnly Cookies**: Session tokens are transmitted via HttpOnly SameSite cookies to protect against client-side script theft.
- **Bcrypt Password Storage**: Passwords are saved with bcrypt hashing (>= 12 rounds); plaintext passwords are never logged or stored.

---

## 17. Current Limitations

- **WebUSB Chromium Requirement**: The WebUSB feature requires a Chromium-based browser (Chrome, Edge, Opera, Brave).
- **iOS Device Agent Companion**: iOS device interaction requires the lightweight companion agent (`qa-device-agent`) running on the host machine connected to the iOS hardware.
- **Subnet Proximity**: Wireless ADB pairing and mDNS discovery require the Android device and QA platform to reside on the same Wi-Fi subnet without wireless client isolation.

---

## 18. License

MIT License. Built for Mobile QA and Release Engineering Teams.
