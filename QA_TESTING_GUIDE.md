# Android Play Asset Delivery (PAD) & ORD QA Testing Guide

This guide provides QA engineers with instructions on testing Android Play Asset Delivery (PAD) and On-Demand Resources (ORD) using the Web-Based QA Platform and host automation tools.

---

## 1. What is Play Asset Delivery (PAD)?

Play Asset Delivery (PAD) is Google Play's solution for delivering large game and application assets. It replaces traditional expansion files (OBBs) by packaging asset packs into the Android App Bundle (`.aab`).

PAD supports three delivery modes:
1. **`install-time`**: Asset packs are downloaded alongside the base application APK upon installation.
2. **`fast-follow`**: Asset packs begin downloading immediately in the background after the application is installed.
3. **`on-demand`**: Asset packs are requested dynamically by the app runtime using the Play Core / Play Asset Delivery API (`AssetPackManager`).

---

## 2. Testing PAD Locally with Bundletool

In production, Google Play manages asset pack downloads. In QA and local testing, Google provides the `--local-testing` mode in **Bundletool**.

When an `.apks` file is generated with `--local-testing`:
* Bundletool embeds a local mock asset delivery server inside the generated APKs.
* When the app requests asset packs via `AssetPackManager` or `AssetPackHelper`, the calls are routed to the local mock provider without contacting Google Play servers.
* Logs are emitted to Android Logcat under tags such as `AssetPackHelper`, `PlayCore`, and `PlayAssetDelivery`.

---

## 3. Connecting Devices via Wireless Debugging

Android 11 (API 30) and newer support Wireless Debugging over Wi-Fi.

### Step-by-Step Pairing:
1. Connect your Android device to the **same Wi-Fi network** as the QA host machine.
2. On your device, open **Settings → System → Developer Options**.
3. Scroll to **Wireless Debugging** and toggle it **ON**.
4. Tap **"Pair device with pairing code"**.
5. A dialog will appear with:
   - **Wi-Fi pairing code** (6 digits, e.g. `842109`)
   - **IP address & Port** (e.g. `192.168.1.105:37129`)
6. On the QA Web Platform:
   - Click **Connect Device** / **Pair New Device**.
   - Enter IP (`192.168.1.105`), Pairing Port (`37129`), and Code (`842109`).
   - Click **Pair Device**.
7. Once paired, close the pairing dialog on your Android device.
8. Look at the main **Wireless Debugging** screen for the active **IP address & Port** (e.g. `192.168.1.105:41235`).
9. Enter the connection port into the QA platform and click **Connect Device**.
10. The device will show a **Connected 🟢** status with battery, storage, and OS telemetry.

---

## 4. End-to-End PAD Testing Workflow

```
1. Open QA Web Dashboard (http://localhost:3000)
2. Pair & Connect Android Device via Wireless Debugging
3. Upload Latest .aab Build (Drag & Drop)
4. Review Build Information & Detected Asset Packs
5. Navigate to "Run PAD Test"
6. Choose Installation Mode:
   - [x] Fresh Install (Clean uninstallation of previous build)
   - [ ] Update Existing App (Preserves existing application storage)
7. Click [ ▶ Run PAD Test ]
8. Watch real-time execution steps, progress bar (0% -> 100%), and live Logcat output
9. Review PASS / FAIL result and download execution logs
```

---

## 5. Interpreting Results & Troubleshooting

### PASS Criteria:
* Bundletool successfully generated test APKs with `--local-testing`.
* APKs installed and verified on the target Android device.
* Application launched without immediate crash.
* Logcat confirmed `AssetPackHelper` / `PlayCore` initialized and completed asset extraction.

### Common Failure Scenarios & Fixes:

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| **"Device is not reachable from QA server"** | Device and QA host are on different subnets or Wi-Fi isolation is enabled. | Ensure both devices are on the same Wi-Fi router without client isolation. |
| **"Pairing failed"** | Pairing code expired or port changed. | Re-open the pairing dialog on Android to generate a new port and code. |
| **"INSTALL_FAILED_VERSION_DOWNGRADE"** | An existing app with a higher version code exists. | Select **Fresh Install** mode so the platform uninstalls the older version first. |
| **"INSUFFICIENT_STORAGE"** | Device has inadequate storage for asset packs. | Use the **ADB Operations** page to inspect free storage or uninstall older builds. |
| **"AssetPackHelper timeout"** | App did not trigger asset download on startup. | Ensure the app's initial scene or startup activity calls `fetchAssetPacks()`. |
