/**
 * Centralized QA Tools Platform — Master SOP Documentation Data
 * Complete, beginner-friendly operational procedures, prerequisites,
 * step-by-step instructions, troubleshooting, and safety warnings for every platform module.
 */

export const SOP_CATEGORIES = [
  { id: 'all', label: 'All Guides' },
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'devices-mirroring', label: 'Devices & Mirroring' },
  { id: 'execution-testing', label: 'Execution & Testing' },
  { id: 'feature-flags', label: 'Feature Flags' },
  { id: 'defect-tracking', label: 'Defect Tracking' },
  { id: 'admin-reference', label: 'Admin & Reference' }
];

export const SOP_GUIDES = [
  // 1. QUICK START GUIDE
  {
    id: 'quickstart',
    categoryId: 'getting-started',
    title: '1. Quick Start: Daily QA Testing Workflow',
    badge: 'Onboarding',
    summary: 'A complete step-by-step walkthrough of the standard daily QA cycle from device connection to defect reporting.',
    overview: {
      name: 'New QA Engineer Daily Workflow',
      description: 'The standard sequential operating procedure for a QA engineer starting their daily testing session on the Centralized QA Tools Platform. This guide outlines how the platform modules link together into a smooth, repeatable verification cycle.',
      whenToUse: 'Use this workflow at the start of every testing shift, sprint release cycle, or when executing a new test plan against an Android or iOS build.',
      example: 'A new mobile build (e.g. DesignWiz v2.4.0-qa) is uploaded to Google Drive. You need to connect your physical Android test phone, install the bundle, execute Play Asset Delivery verification, validate Mixpanel analytics, test dynamic Remote Config feature flags, and file any found bugs into Jira.'
    },
    prerequisites: [
      'Active user account on the QA Platform (Sign in via top header or welcome banner).',
      'Physical Android device (Android 11+) with Developer Options and USB/Wireless Debugging enabled.',
      'Target application binary (.aab or .apk build file).',
      'Host workstation connected to the same Wi-Fi network as the test device.'
    ],
    steps: [
      {
        step: 1,
        title: 'Sign In and Verify System Diagnostics',
        action: 'Open the QA Platform web interface. If prompted by the banner, click "Sign In / Register" in the top header. Check the Server Status badge in the header (must show a green checkmark indicating ADB, Java, and Bundletool are ready). If unready, navigate to "System Diagnostics" in the sidebar to inspect environment health.'
      },
      {
        step: 2,
        title: 'Connect Your Test Device',
        action: 'Plug your Android device into your workstation via USB or click "Connect Browser USB" on the Dashboard. For wireless testing, click "Pair Device (Wi-Fi)", enter the 6-digit Wi-Fi pairing code and port from your phone\'s Developer Options screen, and connect. Verify your device appears in the "Connected Devices" selector in the global header.'
      },
      {
        step: 3,
        title: 'Select or Upload Target Build',
        action: 'Navigate to "Builds & AAB" in the sidebar. If testing a new build, click "Upload AAB / APK" and drop your .aab file. Wait for Bundletool to automatically parse the package name and asset packs. Click "Select as Active Build" on the build card.'
      },
      {
        step: 4,
        title: 'Execute Automated PAD / ORD Pipeline',
        action: 'Navigate to "Run PAD Test" in the sidebar (or press Alt + Q). Verify your connected device and active build are selected. Select "Fresh Install" mode and keep "Launch App" checked. Click "Run Play Asset Delivery Test". Monitor the 9-stage pipeline and live logcat until the green "PASSED" banner appears.'
      },
      {
        step: 5,
        title: 'Perform Interactive Testing with Screen Mirror',
        action: 'Click "Screen Mirror" in the sidebar (or the "Mirror" button in the header). Interact directly with the phone on your desktop screen. Click "Start Recording" to capture your reproduction video if you encounter a bug, and click "Stop Recording" to download the MP4 or send it to Bug Desk.'
      },
      {
        step: 6,
        title: 'Validate Remote Config & Log Defects',
        action: 'If testing feature flags, navigate to "Remote Config", select your platform and app, toggle the required keys, and verify in-app changes. If an issue is observed, navigate to "Bug Desk", paste raw notes into "New Bug", generate an AI report, attach your mirror recording, and click "Submit to PMS" to create the Jira/Linear issue.'
      }
    ],
    expectedResult: {
      appearance: 'The application installs successfully on the target phone, passes asset delivery simulation, and opens to the home screen. Test results are recorded in Test History, analytics are verified in Mixpanel Validator, and any defects are tracked in Bug Desk with video proof.',
      verification: 'Verify that the test execution card in Test History displays a green "PASSED" badge and that in-app features respond accurately to Remote Config changes.'
    },
    troubleshooting: [
      {
        issue: 'Device selector in the header shows "No devices available"',
        solution: 'Check USB cable connection or ensure phone is awake and developer prompt "Allow USB debugging?" is accepted. If using WebUSB, ensure no conflicting adb server instance is locking the hardware serial.'
      },
      {
        issue: 'Cannot upload .aab file (upload button disabled or network error)',
        solution: 'Ensure you are signed into an authenticated account. Unauthenticated users have read-only access and cannot upload builds or initiate tests.'
      }
    ],
    warnings: [
      'Do not unplug USB cables or switch Wi-Fi networks while a PAD test or AAB installation is in progress.',
      'Always release shared physical devices when finishing your shift so other team members can access them.'
    ]
  },

  // 2. DASHBOARD
  {
    id: 'dashboard',
    categoryId: 'getting-started',
    title: '2. QA Dashboard & Navigation Overview',
    badge: 'Foundation',
    summary: 'How to monitor real-time platform KPIs, active device statuses, active builds, and launch quick test actions.',
    overview: {
      name: 'QA Dashboard',
      description: 'The Centralized QA Platform Dashboard provides a real-time command center displaying connected physical and browser devices, active application builds, recent test execution summaries, and system environment readiness.',
      whenToUse: 'Check the Dashboard upon launching the platform to quickly verify active device health, select your active build, and check whether background tests are running.',
      example: 'Before starting a testing sprint, look at the Dashboard KPI metrics to confirm that 2 test phones are online, the latest DesignWiz AAB is selected, and server ADB diagnostics are healthy.'
    },
    prerequisites: [
      'Active user account on the platform (sign in if the "Authentication Required" banner appears).',
      'Platform backend server running on port 8080.'
    ],
    steps: [
      {
        step: 1,
        title: 'Inspect Summary Metric Cards',
        action: 'View the four KPI cards at the top of the Dashboard: "Total PAD Tests" (cumulative automated tests run), "Pass Rate" (percentage of passed runs), "Connected Devices" (total online devices available to your account), and "Uploaded Builds" (stored AAB/APK packages ready for testing).'
      },
      {
        step: 2,
        title: 'Review Target Device Status',
        action: 'Inspect the "Target Device" card on the left. It displays the currently selected phone\'s model name, manufacturer, Android OS version, battery percentage, and hardware serial number. If no device is active, click "Pair / Connect" or "Connect Device via Wireless Debugging". When connected, click "Open Screen Mirror" for immediate access.'
      },
      {
        step: 3,
        title: 'Review Active Build Information',
        action: 'Inspect the "Active Build" card on the right. Verify the package name, version name, version code, and number of detected asset pack modules. If you need a different build, click "Upload .aab" or navigate to "Builds & AAB".'
      },
      {
        step: 4,
        title: 'Use Quick Action Launchers',
        action: 'Use the quick buttons on the hero banner and cards to trigger common workflows: click "Open Test Console" to jump straight to Run PAD Test, or click "Open Screen Mirror" to interact with the device.'
      }
    ],
    expectedResult: {
      appearance: 'Target device displays a green battery and connection indicator; active build displays verified package metadata. Summary counters accurately reflect system state.',
      verification: 'Clicking "Open Screen Mirror" on the device card opens mirroring; clicking "Upload .aab" opens the bundle upload modal.'
    },
    troubleshooting: [
      {
        issue: 'Dashboard counters display 0 or spinner does not disappear',
        solution: 'Click the browser refresh button. If the problem persists, check System Diagnostics to confirm backend server port 8080 is running and responding to API requests.'
      },
      {
        issue: '"Authentication Required" banner appears above content',
        solution: 'Click "Sign In / Register" on the banner, enter your QA email and password, and click Submit. Device ownership and build management require user authentication.'
      }
    ],
    warnings: [
      'The Dashboard reflects your private user session. Devices claimed by other QA engineers will not appear in your personal list to prevent session collisions.'
    ]
  },

  // 3. DEVICES & OWNERSHIP
  {
    id: 'devices',
    categoryId: 'devices-mirroring',
    title: '3. Connected Test Devices & Ownership Management',
    badge: 'Connectivity',
    summary: 'Connecting Android devices via USB and Wi-Fi Wireless Pairing, understanding user device isolation, and diagnosing hardware links.',
    overview: {
      name: 'Connected Test Devices',
      description: 'The Connected Devices module enables QA engineers to discover, pair, manage, and monitor physical Android hardware. It supports direct Server ADB connections, client-side WebUSB connections, and Android 11+ Wi-Fi Wireless Debugging pairing.',
      whenToUse: 'Use this module whenever setting up a new test phone, switching between physical and Wi-Fi debugging, or releasing a shared device back to the pool.',
      example: 'You have a Google Pixel 7 running Android 14. You want to disconnect the physical USB cable and test over the office Wi-Fi network using Android Wireless Debugging pairing code.'
    },
    prerequisites: [
      'Android device running Android 11 (API 30) or higher for native Wi-Fi pairing code support.',
      'Developer Options unlocked (Settings → About Phone → tap "Build Number" 7 times).',
      'USB Debugging and Wireless Debugging toggled ON in Developer Options.',
      'Phone and QA host computer connected to the exact same Wi-Fi subnet (no client isolation).'
    ],
    steps: [
      {
        step: 1,
        title: 'Navigate to Devices Tab',
        action: 'Click "Connected Devices" in the sidebar navigation.'
      },
      {
        step: 2,
        title: 'Option A: Connect via Physical USB Cable',
        action: 'Plug the device into the computer with a high-quality data cable. Accept the "Allow USB debugging?" prompt on the phone screen (check "Always allow from this computer"). The device appears in the device list within 5 seconds with a green USB badge.'
      },
      {
        step: 3,
        title: 'Option B: Connect via Browser WebUSB (Direct Browser ADB)',
        action: 'Click "Connect Browser USB" on the toolbar. The browser will open a WebUSB device selector modal. Select your Android phone from the list and click "Connect". This creates a direct high-speed WebUSB bridge independent of server ADB.'
      },
      {
        step: 4,
        title: 'Option C: Connect via Wi-Fi Wireless Debugging',
        action: 'On your phone, open Settings → System → Developer options → Wireless debugging (toggle ON). Tap "Pair device with pairing code". Note the 6-digit PIN and the IP:PairingPort shown in the popup. In the QA Platform, click "Pair Device (Wi-Fi)". Enter the IP address, the Pairing Port, and the 6-digit pairing PIN, then click "Pair & Connect".'
      },
      {
        step: 5,
        title: 'Understand Device Ownership Isolation',
        action: 'Notice the "Owner" badge on the device card. When you pair or select a device, it is reserved exclusively for your account. Other QA engineers logged into the platform cannot see or send commands to your device while your session is active.'
      },
      {
        step: 6,
        title: 'Disconnecting and Releasing Devices',
        action: 'When you finish testing, click "Disconnect" on the device card. This releases the device lock, unclaims the ADB port, and makes the hardware available for other teammates.'
      }
    ],
    expectedResult: {
      appearance: 'Device card displays model name (e.g. Pixel 7), brand, OS version (Android 14), serial number, battery percentage bar, and an online status pill.',
      verification: 'Open the device selector in the top header and verify that the newly paired device appears in the dropdown list and can be selected.'
    },
    troubleshooting: [
      {
        issue: 'Device shows status "Unauthorized"',
        solution: 'Unlock your phone screen, look for the "Allow USB debugging?" dialog, check "Always allow", and tap "Allow". If prompt does not appear, toggle USB Debugging OFF and back ON in Developer Options.'
      },
      {
        issue: 'Wireless pairing fails with "Connection timed out"',
        solution: 'Ensure phone and computer are on the same Wi-Fi network (not guest Wi-Fi). Note that Android generates a temporary pairing port inside the popup that differs from the permanent wireless debugging port.'
      },
      {
        issue: 'WebUSB fails with "Device claimed by another process"',
        solution: 'Kill host ADB processes on your machine (run `adb kill-server` in terminal) so the browser can acquire raw USB interface access.'
      }
    ],
    warnings: [
      'Do not keep developer options Wi-Fi debugging enabled on personal devices outside of secure testing networks.',
      'Always click Disconnect when finished testing on shared lab devices.'
    ]
  },

  // 4. SCREEN MIRROR
  {
    id: 'screen-mirror',
    categoryId: 'devices-mirroring',
    title: '4. Real-Time Screen Mirroring & Session Recording',
    badge: 'Mirroring',
    summary: 'Streaming low-latency H.264 video, controlling Android devices with mouse/keyboard, recording MP4 test sessions, and uploading to Bug Desk.',
    overview: {
      name: 'Screen Mirror',
      description: 'Provides real-time, 60fps, low-latency device screen mirroring powered by WebSocket/H.264 video streaming (scrcpy backend). Enables desktop touch interaction, hardware button simulation, and built-in screen recording with direct MP4 export.',
      whenToUse: 'Use Screen Mirror when performing exploratory QA, taking screenshots, testing UI responsiveness, or recording video evidence of a software defect.',
      example: 'You discover a visual glitch on the checkout screen. You start Screen Mirror, click "Start Recording", reproduce the bug steps, stop recording, and attach the MP4 video directly to a new bug report in Bug Desk.'
    },
    prerequisites: [
      'Connected Android device with status Online and ADB authorized.',
      'Device selected in the global header or page device selector.',
      'Hardware video decoding enabled in your desktop web browser.'
    ],
    steps: [
      {
        step: 1,
        title: 'Open Screen Mirror Tab',
        action: 'Click "Screen Mirror" in the sidebar navigation or click the "Mirror" button in the global header.'
      },
      {
        step: 2,
        title: 'Select Target Device',
        action: 'If you have multiple devices connected, select the desired device from the top device selector. The video stream will negotiate the H.264 pipeline and begin displaying within 1-2 seconds.'
      },
      {
        step: 3,
        title: 'Interact with the Device',
        action: 'Use your mouse cursor directly on the phone display area: Click to tap buttons, click and drag to swipe or scroll, right-click to simulate Android Back. Use the overlay navigation bar below the stream to click Home, Recent Apps, Volume Up/Down, or Power.'
      },
      {
        step: 4,
        title: 'Start Video Recording',
        action: 'Click the "Start Recording" button on the floating recording toolbar. A glowing red recording indicator will appear showing the elapsed time counter (e.g. `REC 00:15`).'
      },
      {
        step: 5,
        title: 'Stop Recording and Review',
        action: 'Execute your test steps on the mirrored screen. When finished, click the red "Stop Recording" button. The Recording Preview modal will immediately open with the recorded video playable inside.'
      },
      {
        step: 6,
        title: 'Save or Export Recording',
        action: 'In the preview dialog, click "Download MP4" to save the recording to your local downloads folder, or click "Send to Bug Desk" to automatically pre-attach this recording to a new defect report.'
      }
    ],
    expectedResult: {
      appearance: 'Crisp, real-time video mirroring with under 50ms latency. Smooth mouse drag and touch responsiveness.',
      verification: 'Moving a screen slider on the desktop mirror updates the physical phone screen instantaneously. Recorded MP4 files play back cleanly in standard video players.'
    },
    troubleshooting: [
      {
        issue: 'Mirror screen displays black or spinner persists',
        solution: 'Unlock the physical phone screen (screen mirror cannot stream if device is asleep with screen off). If stream remains black, click the device selector and re-select the device to restart the video socket.'
      },
      {
        issue: 'Touch clicks on the screen are offset or misaligned',
        solution: 'Wait 1 second for the video metadata to synchronize orientation when rotating phone between portrait and landscape.'
      },
      {
        issue: 'Recording preview modal shows 00:00 duration or will not play',
        solution: 'Ensure recording is at least 2 seconds long so the video container can write keyframes properly before closing the stream.'
      }
    ],
    warnings: [
      'High-resolution screen mirroring consumes notable network bandwidth over Wi-Fi. For intensive recording, USB connection is recommended.',
      'Stop active recordings before navigating away from the Screen Mirror tab to avoid incomplete video files.'
    ]
  },

  // 5. UI INSPECTOR
  {
    id: 'ui-inspector',
    categoryId: 'devices-mirroring',
    title: '5. UI Inspector & Typography Accessibility Analysis',
    badge: 'Inspection',
    summary: 'Deep XML DOM tree hierarchy inspection, element boundary discovery, accessibility contrast validation, and typography styling audit.',
    overview: {
      name: 'UI Inspector',
      description: 'The UI Inspector captures the active Android view hierarchy using automated uiautomator dumps and renders an interactive layout inspection canvas. QA engineers can inspect view IDs, class names, accessibility labels, and perform typography contrast audits against WCAG 2.1 guidelines.',
      whenToUse: 'Use this tool when finding element resource-IDs for automated test scripts, validating touch target dimensions (minimum 48x48dp), or verifying typography font sizes and color contrast.',
      example: 'You need to write an Appium automation script and need the exact resource-id for the "Checkout Now" button, while verifying that the button meets accessibility contrast standards.'
    },
    prerequisites: [
      'Connected Android device with screen unlocked.',
      'Target application open and resting on the screen you wish to inspect.'
    ],
    steps: [
      {
        step: 1,
        title: 'Navigate to UI Inspector',
        action: 'Click "UI Inspector" in the sidebar navigation.'
      },
      {
        step: 2,
        title: 'Capture Current UI Hierarchy',
        action: 'With your phone showing the desired app screen, click "Capture UI Hierarchy" in the inspector toolbar. The platform will execute an automated UI XML dump and capture a high-resolution screenshot.'
      },
      {
        step: 3,
        title: 'Select and Inspect UI Elements',
        action: 'Hover your cursor over the screenshot to see visual element bounding boxes. Click on any button, text label, or image. The selected element is highlighted in green, and the left hierarchy tree automatically expands to that node.'
      },
      {
        step: 4,
        title: 'Read Node Properties',
        action: 'Review the right-hand Properties Panel. Inspect `resource-id` (e.g. `com.example:id/btn_checkout`), `class` (e.g. `android.widget.Button`), `text`, `content-desc`, `bounds`, and boolean flags (`clickable`, `focusable`, `scrollable`).'
      },
      {
        step: 5,
        title: 'Inspect Typography & Accessibility Card',
        action: 'Scroll down the Properties Panel to the "Typography & Accessibility" evaluation section. Review computed font size in sp, text color hex, background contrast ratio, and pass/fail indicator for WCAG AA (4.5:1 ratio) and AAA compliance.'
      }
    ],
    expectedResult: {
      appearance: 'Complete layout snapshot matching the physical phone screen with green selection rectangles and structured XML tree.',
      verification: 'Clicking different elements updates the properties pane instantaneously and displays accurate coordinates in `[left,top][right,bottom]` format.'
    },
    troubleshooting: [
      {
        issue: 'UI dump fails with "uiautomator timed out"',
        solution: 'Ensure the phone screen is not displaying an ongoing animation, video playback, or loading spinner, which can block uiautomator from acquiring an idle frame.'
      },
      {
        issue: 'Elements inside WebView or Flutter show as single large container',
        solution: 'Non-native views (WebViews, Canvas, Flutter without semantics) require accessibility features enabled in build. In Flutter, enable `SemanticsBinding.instance.ensureSemantics()`. In WebViews, inspect via Chrome DevTools remote debugging.'
      }
    ],
    warnings: [
      'Do not interact with the physical device screen while the UI hierarchy is actively dumping (takes ~2 seconds).'
    ]
  },

  // 6. BUILDS & AAB
  {
    id: 'builds',
    categoryId: 'execution-testing',
    title: '6. Builds & AAB Management (Upload & Manifest Inspection)',
    badge: 'Builds',
    summary: 'Uploading Android App Bundles (.aab) and APKs, automatic manifest extraction, asset pack verification, and active build selection.',
    overview: {
      name: 'Builds & AAB',
      description: 'The Builds module is the binary repository of the QA platform. It manages uploaded .aab bundles and .apk packages, automatically running Bundletool manifest inspection to extract package names, versioning, SDK limits, and asset pack configurations.',
      whenToUse: 'Use this module whenever a developer shares a new test build, or when selecting which application build to install and validate across test suites.',
      example: 'A developer delivers `designwiz-2.4.0-qa.aab`. You upload the file, confirm that the on-demand asset pack `graphics_pack_01` is detected in the manifest, and set it as the active build for testing.'
    },
    prerequisites: [
      'Signed or QA-debug signed .aab or .apk build file (maximum file size 2GB).',
      'Authenticated QA user session.'
    ],
    steps: [
      {
        step: 1,
        title: 'Open Builds & AAB Tab',
        action: 'Click "Builds & AAB" in the sidebar navigation.'
      },
      {
        step: 2,
        title: 'Click Upload AAB / APK',
        action: 'Click the "Upload AAB / APK" button in the page header. The upload modal opens.'
      },
      {
        step: 3,
        title: 'Select or Drag Build File',
        action: 'Drag your `.aab` or `.apk` file into the designated upload zone or click "Browse files". The upload progress bar displays real-time upload speed and completion percentage.'
      },
      {
        step: 4,
        title: 'Automatic Manifest Inspection',
        action: 'Upon upload completion, Bundletool parses the Android binary XML manifest on the server. Review the extracted metadata: Package Name, Version Code, Version Name, Min SDK, Target SDK, and detected Asset Pack modules.'
      },
      {
        step: 5,
        title: 'Select Build as Active for Testing',
        action: 'Click "Select as Active Build" on the build card. A purple "ACTIVE BUILD" badge appears on the card. This build will now be used automatically by Run PAD Test, Mixpanel Validator, and Dashboard quick actions.'
      },
      {
        step: 6,
        title: 'Deleting Obsolete Builds',
        action: 'To delete an outdated build, click the Trash icon on the build card and confirm the deletion. The file is safely purged from server storage.'
      }
    ],
    expectedResult: {
      appearance: 'New build card appears in the grid showing package name, version badges, asset pack breakdown, and file size.',
      verification: 'Navigate to "Run PAD Test" and verify that the selected build dropdown defaults to your newly uploaded build.'
    },
    troubleshooting: [
      {
        issue: 'Upload errors with "Invalid bundle format" or "Cannot parse manifest"',
        solution: 'Verify the build was generated via Android Studio\'s "Build → Generate Signed Bundle / APK" and is not a corrupted or partially exported zip.'
      },
      {
        issue: 'Asset packs do not appear in the metadata breakdown',
        solution: 'Check your project\'s `settings.gradle` to ensure dynamic feature asset packs are declared with `:asset_pack_name` and have valid `build.gradle` asset pack configurations.'
      }
    ],
    warnings: [
      'Deleting a build cannot be undone. Verify that no ongoing test session is currently referencing the build before confirming deletion.'
    ]
  },

  // 7. GOOGLE DRIVE
  {
    id: 'google-drive',
    categoryId: 'execution-testing',
    title: '7. Google Drive Integration & Cloud Asset Storage',
    badge: 'Cloud Sync',
    summary: 'OAuth authentication, directory navigation, selecting destination folders, and uploading test recordings and logs to Google Drive.',
    overview: {
      name: 'Google Drive Explorer',
      description: 'Integrates the QA Platform with Google Drive cloud storage. Enables direct cloud backup of test recordings, screenshots, and test execution logs into team shared folders without downloading large files to local disks.',
      whenToUse: 'Use Google Drive when archiving video proof of critical bugs, saving baseline test run logs, or sharing test artifacts with remote development teams.',
      example: 'You have recorded a 50MB screen mirror video of an intermittent app crash. You upload it directly into the team shared Google Drive folder `QA-Sprint-14/Bug-Evidence` and copy the link into a bug report.'
    },
    prerequisites: [
      'Google account with access to your team\'s QA Google Drive storage.',
      'Google Drive integration enabled in platform backend configuration.'
    ],
    steps: [
      {
        step: 1,
        title: 'Open Google Drive Tab',
        action: 'Click "Google Drive" in the sidebar navigation.'
      },
      {
        step: 2,
        title: 'Authenticate Google Account',
        action: 'If not already connected, click "Connect Google Drive". A secure Google OAuth window opens. Sign in with your team Google account and grant Drive file permissions. Upon redirect, your account email appears in the header.'
      },
      {
        step: 3,
        title: 'Browse Folders and Files',
        action: 'Double-click any folder row in the table to navigate into subdirectories. Use the breadcrumb bar at the top (e.g. `My Drive > QA-Testing > Sprint-24`) to navigate back to parent folders.'
      },
      {
        step: 4,
        title: 'Select Destination Folder',
        action: 'Navigate into the folder where you want to upload test artifacts. Click "Set as Default Upload Folder" if you want recordings from Screen Mirror and Bug Desk to save here automatically.'
      },
      {
        step: 5,
        title: 'Upload Files Directly',
        action: 'Click "Upload File", select your MP4 video or log file from your workstation, and click Open. A live progress toast displays upload progress and confirms completion.'
      }
    ],
    expectedResult: {
      appearance: 'Files and folders display cleanly with file icons, size in MB/GB, and last modified dates.',
      verification: 'Uploaded file appears immediately in the directory table and can be verified by opening Google Drive in a separate browser tab.'
    },
    troubleshooting: [
      {
        issue: 'OAuth redirect error or "Token expired"',
        solution: 'Click "Disconnect Account" in the user menu on Google Drive page, then click "Connect Google Drive" to re-authenticate and refresh the OAuth token.'
      },
      {
        issue: 'Shared Drive folders do not appear in list',
        solution: 'Ensure your Google account has "Viewer" or "Content Manager" permission on the Shared Drive in Google Drive settings.'
      }
    ],
    warnings: [
      'Do not upload confidential production user data or unmasked credentials to shared Google Drive folders.'
    ]
  },

  // 8. RUN PAD TEST
  {
    id: 'run-test',
    categoryId: 'execution-testing',
    title: '8. Automated PAD / ORD Test Pipeline',
    badge: 'Execution',
    summary: 'Executing automated Play Asset Delivery testing with Google Bundletool local testing simulation, monitoring logcat, and validating assets.',
    overview: {
      name: 'Automation Test Runner (Run PAD Test)',
      description: 'The core automated pipeline for validating Google Play Asset Delivery (PAD) and On-Demand Resources (ODR). Uses Google Bundletool\'s `--local-testing` mode to extract split APKs and mock asset packs directly onto the phone, intercepting PlayCore API calls to simulate real Google Play CDN responses.',
      whenToUse: 'Run this test on every new build before QA sign-off to ensure install-time, fast-follow, and on-demand asset packs load without missing files or runtime crashes.',
      example: 'You run an automated PAD test on `designwiz.aab`. The pipeline installs split APKs, launches the app, monitors PlayCore AssetPackHelper download state transitions (DOWNLOADING → TRANSFERRING → COMPLETED), and reports PASS.'
    },
    prerequisites: [
      'Connected Android phone with status Online.',
      'Active `.aab` build selected in Builds & AAB.',
      'Android SDK `adb`, `java` (JDK 11+), and `bundletool` ready (verified in Diagnostics).'
    ],
    steps: [
      {
        step: 1,
        title: 'Open Run PAD Test Tab',
        action: 'Click "Run PAD Test" in the sidebar navigation or press Alt + Q.'
      },
      {
        step: 2,
        title: 'Configure Execution Parameters',
        action: 'Verify your connected phone is selected in "Target Device" and your intended bundle is in "Target Build". Select Install Mode: choose "Fresh Install (Clean Package)" for clean test runs, or "App Update Mode" to preserve app data. Leave "Launch App on Completion" checked. Set Monitoring Timeout (default 120s).'
      },
      {
        step: 3,
        title: 'Start Pipeline Execution',
        action: 'Click "Run Play Asset Delivery Test" (or press Alt + Q). The button switches to a running spinner and the 9-stage pipeline begins.'
      },
      {
        step: 4,
        title: 'Monitor 9 Pipeline Stages in Real Time',
        action: 'Watch each step card transition from PENDING to RUNNING to green COMPLETED:\n1. Checking Prerequisites (Java, ADB, Bundletool)\n2. Validating Connected Android Device\n3. Analyzing AAB and Asset Packs\n4. Handling Install Mode (Uninstall / Clean)\n5. Generating APKs with Bundletool Local Testing\n6. Installing Generated Split APKs on Device\n7. Launching Application on Target Device\n8. Monitoring AssetPackHelper & Download Status\n9. Final PAD Verification & Result Analysis'
      },
      {
        step: 5,
        title: 'Inspect Live Execution Console',
        action: 'Review live logcat streaming in the bottom console panel. Filter logs by severity (All, Info, Warn, Error) or search for `AssetPackManager` to see dynamic asset pack requests and local testing mock responses.'
      },
      {
        step: 6,
        title: 'Use Controlled ADB Actions Toolbar',
        action: 'Use the quick buttons in the top right to control the app runtime during or after testing: "Relaunch" (Alt + R), "Clear Data" (Alt + D), "Clear Cache" (Alt + C), or "Uninstall" (Alt + U).'
      }
    ],
    expectedResult: {
      appearance: 'All 9 pipeline stages display green checkmarks. A success toast displays "Play Asset Delivery Test PASSED".',
      verification: 'The test execution is permanently recorded in "Test History" with execution duration, device serial, and full logcat snapshot.'
    },
    troubleshooting: [
      {
        issue: 'Step 4/5 fails with "INSTALL_FAILED_INSUFFICIENT_STORAGE"',
        solution: 'The Android phone does not have enough free internal storage to hold both split APKs and extracted mock asset packs. Free up at least 2GB storage on the device.'
      },
      {
        issue: 'Step 8 fails with "Asset pack monitoring timed out"',
        solution: 'The app did not request its on-demand asset pack within the timeout window. Ensure the app triggers `AssetPackManager.fetch()` on startup, or increase the Monitoring Timeout slider to 240 seconds.'
      },
      {
        issue: 'Confirmation dialog appears: "App is already installed"',
        solution: 'Click "Confirm & Reinstall" on the prompt to allow the pipeline to uninstall the existing signature-conflicting build and proceed.'
      }
    ],
    warnings: [
      '"Fresh Install" mode executes `adb uninstall <package>` before installing. Any locally stored user sessions or databases inside the app will be wiped.',
      'Do not unplug the device or press phone hardware keys while Bundletool is generating split APKs.'
    ]
  },

  // 9. TEST HISTORY
  {
    id: 'test-history',
    categoryId: 'execution-testing',
    title: '9. Test Execution History & Audit Logs',
    badge: 'Reporting',
    summary: 'Auditing past automated test runs, inspecting step-by-step failure points, downloading logcat files, and verifying release sign-off.',
    overview: {
      name: 'Test Execution History',
      description: 'Maintains an immutable historical record of all automated test sessions executed across the platform. Enables QA leads and engineers to audit regression trends, inspect past execution logs, verify test durations, and download raw test artifacts.',
      whenToUse: 'Review Test History before release sign-off meetings, when triaging intermittent test failures, or when comparing test results across different app builds or devices.',
      example: 'A developer asks why Build 204 failed on a Samsung Galaxy S22 yesterday. You open Test History, filter by "Failed", open the run details, and inspect the exact error at Step 7: APK signature mismatch.'
    },
    prerequisites: [
      'None. Test History is a read-only historical audit module accessible to all authenticated QA engineers.'
    ],
    steps: [
      {
        step: 1,
        title: 'Open Test History Tab',
        action: 'Click "Test History" in the sidebar navigation.'
      },
      {
        step: 2,
        title: 'Filter Past Runs',
        action: 'Use the top filter bar: search by package name (e.g. `com.example`), filter by status (`Passed`, `Failed`, `Cancelled`, `Running`), or filter by device serial number.'
      },
      {
        step: 3,
        title: 'Inspect Run Summary Row',
        action: 'Review each historical row: Status pill (green PASSED, red FAILED), Package Name & Version, Device Model & Serial, Execution Start Time, Total Duration (e.g. `42s`), and Steps Completed (`9/9`).'
      },
      {
        step: 4,
        title: 'Open Detailed Run Modal',
        action: 'Click "View Details" on any run row. A modal opens displaying the exact status and timestamp of all 9 pipeline steps, the failure reason if applicable, and the full console log output.'
      },
      {
        step: 5,
        title: 'Download Execution Log',
        action: 'In the run details modal, click "Download Raw Logs" to save the complete logcat and Bundletool stdout/stderr transcript as a `.txt` file for bug tickets.'
      }
    ],
    expectedResult: {
      appearance: 'Complete chronological table of all past runs with color-coded status badges and execution metrics.',
      verification: 'Each run entry matches previous test executions recorded on the Run PAD Test page.'
    },
    troubleshooting: [
      {
        issue: 'History table is empty after server restart',
        solution: 'If the backend SQLite database is running in in-memory mode, history resets on server restart. In production, ensure persistent SQLite file storage (`qa_platform.db`) is configured.'
      }
    ],
    warnings: [
      'History logs are saved permanently. Avoid logging raw passwords or API bearer tokens in test logcat streams.'
    ]
  },

  // 10. ADB OPERATIONS
  {
    id: 'adb-operations',
    categoryId: 'execution-testing',
    title: '10. Safe ADB Console & Device Operations',
    badge: 'Terminal',
    summary: 'Executing controlled ADB operations (Relaunch, Clear Data, Clear Cache, Uninstall) and running safe shell commands with safety validation.',
    overview: {
      name: 'ADB Operations & Safe Console',
      description: 'Provides a secure web-based Android Debug Bridge control surface. Features one-click action cards for high-frequency QA operations (Relaunch, Clear Data, Cache, Uninstall) alongside an interactive terminal console with built-in safety whitelisting to block dangerous system-wiping commands.',
      whenToUse: 'Use ADB Operations when resetting an app to first-install state, inspecting system properties, checking battery drain, taking screenshots, or simulating device inputs.',
      example: 'You want to test user onboarding again. Instead of manually navigating phone settings to clear storage, you click "Wipe App Data" (or press Alt + D). The platform executes `pm clear` and immediately resets the app.'
    },
    prerequisites: [
      'Connected Android phone with status Online.',
      'Target package name specified in package input field.'
    ],
    steps: [
      {
        step: 1,
        title: 'Open ADB Operations Tab',
        action: 'Click "ADB Operations" in the sidebar navigation.'
      },
      {
        step: 2,
        title: 'Select Device and Package',
        action: 'Confirm your target phone is selected in the device selector. In the "Target Package" input, enter or verify your application package name (e.g. `com.example.app`).'
      },
      {
        step: 3,
        title: 'Use Quick Action Cards',
        action: 'Click any of the high-safety action buttons:\n- "Relaunch App" (Alt + R): Stops the package and immediately restarts its main activity with logcat monitoring.\n- "Wipe App Data" (Alt + D): Runs `pm clear <package>`, resetting all databases, shared preferences, and cached assets.\n- "Clear Cache" (Alt + C): Removes temporary cache files without clearing login credentials.\n- "Uninstall App" (Alt + U): Completely uninstalls the package from the device.\n- "Battery Status": Dumps battery health, temperature, and percentage.\n- "Take Screenshot": Captures display and saves PNG directly to your computer.'
      },
      {
        step: 4,
        title: 'Use the Safe ADB Interactive Console',
        action: 'Scroll down to the "Safe ADB Console". Type standard Android shell commands into the input box and press Enter. Allowed safe commands include: `getprop`, `pm list packages`, `dumpsys battery`, `dumpsys package`, `input keyevent`, `logcat`, `wm size`, `wm density`.'
      },
      {
        step: 5,
        title: 'Review Command Output',
        action: 'Inspect stdout and stderr streams rendered in the retro dark terminal window. Click "Copy Output" to copy command results to clipboard.'
      }
    ],
    expectedResult: {
      appearance: 'Quick actions trigger toast confirmations (e.g. "✓ Application launched successfully"). Console displays exact Linux terminal output.',
      verification: 'After running "Wipe App Data", opening the app on your phone shows the fresh first-time welcome/onboarding screen.'
    },
    troubleshooting: [
      {
        issue: 'Command rejected with "Command blocked by platform safety validator"',
        solution: 'Destructive commands like `rm -rf`, `wipe`, `format`, `reboot bootloader`, or attempts to overwrite `/system` partition are strictly blocked to protect test lab hardware integrity.'
      },
      {
        issue: 'Quick actions fail with "Package not installed on device"',
        solution: 'Verify the package name spelling in the package input field, or install the build first via Builds & AAB.'
      }
    ],
    warnings: [
      'Clearing application data (`pm clear`) permanently deletes local SQLite databases and saved accounts on the phone.',
      'Never run battery simulation or thermal throttling overrides without resetting them after testing.'
    ]
  },

  // 11. MIXPANEL VALIDATOR
  {
    id: 'mixpanel-validator',
    categoryId: 'execution-testing',
    title: '11. Mixpanel Event & Analytics Schema Validator',
    badge: 'Analytics',
    summary: 'Live event stream capture from device logcat, comparing actual analytics payloads against expected schemas and validating data types.',
    overview: {
      name: 'Mixpanel Validator',
      description: 'Captures live analytics telemetry streamed by the mobile app\'s Mixpanel SDK directly from Android logcat buffers. Parses outgoing event payloads, validates required properties (distinct_id, token, event_name), and compares custom attributes against expected schemas in real time.',
      whenToUse: 'Use this validator during analytics QA to ensure all tracked user events fire with correct parameter names, expected data types (string, number, boolean), and non-empty values.',
      example: 'You trigger the "Purchase Completed" flow in the app. Mixpanel Validator captures the event in real time and flags that `order_id` is missing and `price` is passed as a string `"19.99"` instead of a number `19.99`.'
    },
    prerequisites: [
      'Connected Android phone running a build with Mixpanel SDK enabled.',
      'Application package name configured.'
    ],
    steps: [
      {
        step: 1,
        title: 'Open Mixpanel Validator Tab',
        action: 'Click "Mixpanel Validator" in the sidebar navigation.'
      },
      {
        step: 2,
        title: 'Select Device & Target Package',
        action: 'Select your connected test phone from the device dropdown and verify the target package name in the input box.'
      },
      {
        step: 3,
        title: 'Start Live Event Capture',
        action: 'Click "Start Capturing". The platform connects to the device logcat filter monitoring for Mixpanel SDK tags (`MixpanelAPI`, `mp_event`). A green "LISTENING" status indicator pulses.'
      },
      {
        step: 4,
        title: 'Trigger In-App Actions on Device',
        action: 'Interact with the app on your phone (e.g. click buttons, change tabs, complete onboarding, make purchases). Every time the app calls `mixpanel.track()`, the event card appears instantly in the left feed.'
      },
      {
        step: 5,
        title: 'Inspect Event Properties & Schema Diff',
        action: 'Click on any captured event in the feed (e.g. `screen_viewed`). The right inspection pane opens showing:\n- Event Name, Timestamp, and Distinct ID\n- Property Table: Key, Data Type, and Value\n- Schema Diff: Missing attributes highlighted in Red, data type mismatches in Yellow, and valid properties in Green.'
      },
      {
        step: 6,
        title: 'Export Captured Event Stream',
        action: 'Click "Export JSON" to download the complete session event log as a structured JSON file to attach to analytics QA sign-off tickets.'
      }
    ],
    expectedResult: {
      appearance: 'Chronological event cards appear in real time with event names, property counts, and schema validation pills (VALID / MISMATCH).',
      verification: 'Clicking an event displays the full JSON payload with formatted syntax highlighting and type badges.'
    },
    troubleshooting: [
      {
        issue: 'No events appearing while clicking inside the app',
        solution: 'Enable verbose logging in Mixpanel SDK. Run this command in ADB Operations: `adb shell setprop log.tag.MixpanelAPI VERBOSE`. Also verify device has active internet access to dispatch telemetry.'
      },
      {
        issue: 'Events show "Unknown Schema"',
        solution: 'If no predefined schema exists for the event name, the validator captures the raw payload and inspects property types without schema assertion.'
      }
    ],
    warnings: [
      'Click "Clear Events" before starting a new test scenario to avoid mixing events from previous user journeys.'
    ]
  },

  // 12. REMOTE CONFIG MANAGER
  {
    id: 'remote-config',
    categoryId: 'feature-flags',
    title: '12. Remote Config Manager (Android & iOS)',
    badge: 'Feature Flags',
    summary: 'Managing mobile feature flags, dynamic variables, syntax-highlighted JSON editing, active status toggling, and session-based mutation tracking.',
    overview: {
      name: 'Remote Config Manager',
      description: 'The Centralized Remote Config Manager allows QA engineers to inspect, search, create, edit, toggle, and delete dynamic feature flags, runtime variables, and JSON configuration payloads across both Android and iOS applications.',
      whenToUse: 'Use Remote Config when testing A/B experiments, toggling dark launch features, updating API endpoints, changing paywall pricing parameters, or simulating client behavior under different configuration payloads.',
      example: 'You need to test the new Paywall UI. In Remote Config Manager, select Android → DesignWiz, locate key `paywall_v2_enabled`, change value to `true`, and press Ctrl + Enter to save.'
    },
    prerequisites: [
      'Authenticated QA user session.',
      'Upstream Remote Config service running (Android service on port 2315, iOS on port 2324).'
    ],
    steps: [
      {
        step: 1,
        title: 'Select Target Platform (Android / iOS)',
        action: 'Navigate to "Remote Config" in the sidebar. Click the segmented platform control at the top left to switch between "Android" and "iOS".'
      },
      {
        step: 2,
        title: 'Select Application',
        action: 'Click the "Application" dropdown (e.g. `DesignWiz`). The table fetches and displays all configuration keys registered for that app.'
      },
      {
        step: 3,
        title: 'Search and Filter Configurations',
        action: 'Use the controls toolbar to find keys quickly:\n- Search: Type keyword into search input to filter by key name or value.\n- Type Filter: Filter by `json`, `boolean`, `number`, or `string`.\n- Status Filter: Filter by `Active` or `Inactive`.\n- Sort Filter: Defaults to "Order: Recently Updated" (places keys you created or edited in this session at the top). Switch to "Order: Server (Sr. No)" to restore original server order.'
      },
      {
        step: 4,
        title: 'Create a New Configuration Key',
        action: 'Click "New Config" button in the toolbar. In the modal:\n1. Enter Configuration Key name (snake_case, e.g. `enable_new_cart_flow`).\n2. Select Data Type: `json`, `boolean`, `number`, or `string`.\n3. Enter Configuration Value (if JSON, use the code editor).\n4. Toggle Active switch (green = active on service).\n5. Click "Create Config". The new key immediately appears at the top of the table.'
      },
      {
        step: 5,
        title: 'Edit Existing Key with Ctrl + Enter Save Shortcut',
        action: 'Click the Edit (pencil) icon on any configuration row. The Edit Remote Config modal opens with the key name pinned in the header. Modify the value. For JSON, you can use "Format" (prettify with 2 spaces) or "Minify". While editing, press Ctrl + Enter (or Cmd + Enter on macOS) to save immediately without touching the mouse.'
      },
      {
        step: 6,
        title: 'Toggle Active Status with One Click',
        action: 'In the table\'s "Active" column, click the toggle switch on any row. The status updates immediately on the remote service, showing a green toast confirmation.'
      },
      {
        step: 7,
        title: 'Delete a Configuration Key',
        action: 'Click the Trash icon on the row. The Delete Confirmation modal opens displaying the exact key name. Click "Delete Configuration" to confirm. The key is removed from the table and tracker.'
      }
    ],
    expectedResult: {
      appearance: 'Clean table layout with syntax-highlighted value previews, live active status toggles, and instant updates.',
      verification: 'Editing or creating a key moves it to index 0 under "Order: Recently Updated" and shows a green toast confirmation. Relaunching the app on the phone reflects the new configuration value.'
    },
    troubleshooting: [
      {
        issue: 'Ctrl + Enter does not save and displays "Invalid JSON syntax"',
        solution: 'The JSON editor includes real-time syntax validation. Fix unclosed quotes, trailing commas, or missing brackets indicated in the red error banner before saving.'
      },
      {
        issue: 'Table shows "Failed to load Remote Configs"',
        solution: 'Check if the upstream PHP/Laravel remote config service is online on the local network (Android `:2315`, iOS `:2324`).'
      },
      {
        issue: 'Recently updated key does not appear at the top',
        solution: 'Ensure the Sort dropdown is set to its default value: "Order: Recently Updated". If switched to "Order: Server (Sr. No)", it displays original upstream database ordering.'
      }
    ],
    warnings: [
      'CRITICAL: Remote Config changes propagate to any mobile devices fetching configuration from this environment. Always double-check key names and JSON syntax before saving.',
      'Deleting a configuration key is permanent and removes the key from the remote server.'
    ]
  },

  // 13. BUG DESK
  {
    id: 'bug-desk',
    categoryId: 'defect-tracking',
    title: '13. Bug Desk: AI-Assisted Defect Reporting & PMS Export',
    badge: 'Bug Reporting',
    summary: 'Converting raw tester notes into structured QA defect reports with Gemini AI, attaching screen recordings, and exporting to Jira, Linear, or GitHub.',
    overview: {
      name: 'Bug Desk',
      description: 'An AI-augmented defect tracking workspace built specifically for QA engineers. Converts raw, unstructured tester notes into structured Markdown defect reports using Google Gemini AI, pre-attaches device telemetry and screen mirror recordings, and exports tickets directly to Jira, Linear, or GitHub Issues.',
      whenToUse: 'Use Bug Desk whenever you encounter a defect during exploratory or automated testing and need to file a comprehensive bug report in under 60 seconds.',
      example: 'You reproduce an app crash when tapping the search button. You type "crash on search when query is empty, pixel 7 android 14" into Raw Notes, hit Ctrl + Enter, and Gemini produces a complete report with Reproduction Steps, Expected vs Actual, and device specs ready to push to Jira.'
    },
    prerequisites: [
      'Gemini API key configured in Bug Desk Settings.',
      'Target PMS (Jira / Linear / GitHub) connection credentials configured in Settings.'
    ],
    steps: [
      {
        step: 1,
        title: 'Open Bug Desk Tab',
        action: 'Click "Bug Desk" in the sidebar navigation. The global header shows Bug Desk sub-navigation: "Dashboard", "New Bug", "History", and "Settings".'
      },
      {
        step: 2,
        title: 'Configure Settings (One-Time Setup)',
        action: 'Click "Settings" in the top sub-nav. Enter your Gemini API key (click "Test Key" to verify). Under PMS Integration, choose Jira, Linear, or GitHub, and enter your Instance URL, API Token, Project Key, and Default Issue Type (e.g. `Bug`). Click "Save Settings".'
      },
      {
        step: 3,
        title: 'Open New Bug Workspace',
        action: 'Click "New Bug" in the top sub-nav.'
      },
      {
        step: 4,
        title: 'Enter Raw Notes & Generate AI Report',
        action: 'In the "Raw Notes" editor, paste your observations, logs, or quick reproduction thoughts. Press Ctrl + Enter (or Cmd + Enter on macOS) or click "Generate Bug Report". Gemini AI generates a professional report including:\n- Issue Title\n- Severity / Priority\n- Device Telemetry (Model, OS, Build)\n- Steps to Reproduce (numbered list)\n- Expected Result\n- Actual Result\n- Error Logs / Stack Traces'
      },
      {
        step: 5,
        title: 'Attach Media & Proof',
        action: 'In the Attachments card, attach your MP4 screen recording (from Screen Mirror) or drag screenshot PNGs. Uploaded media is linked into the report.'
      },
      {
        step: 6,
        title: 'Export to PMS or Copy Markdown',
        action: 'Review the editable Markdown preview on the right. Click "Submit to Jira" (or Linear/GitHub). The platform creates the remote issue via API and displays the ticket key (e.g. `PROJ-142`) with a clickable link. Alternatively, click "Copy Markdown" to paste into Slack or Notion.'
      }
    ],
    expectedResult: {
      appearance: 'A fully formatted, professional bug ticket created on Jira/Linear with attached screenshots and reproduction video.',
      verification: 'Click the generated ticket link to open the issue on Jira and confirm all fields and attachments are populated.'
    },
    troubleshooting: [
      {
        issue: 'Report generation fails with "Gemini API key invalid or quota exceeded"',
        solution: 'Open Bug Desk Settings, verify your Gemini API key has no leading/trailing spaces, and ensure your Google AI Studio project has available quota.'
      },
      {
        issue: 'PMS Export fails with "401 Unauthorized" or "Project not found"',
        solution: 'Verify your Jira API token and Project Key (e.g. `QA` or `APP`) in Settings. For Jira Cloud, use your account email and API token, not your account password.'
      }
    ],
    warnings: [
      'Always review AI-generated reproduction steps before submitting tickets to ensure accuracy.'
    ]
  },

  // 14. SYSTEM DIAGNOSTICS
  {
    id: 'diagnostics',
    categoryId: 'admin-reference',
    title: '14. System Diagnostics & Host Environment Health',
    badge: 'Diagnostics',
    summary: 'Inspecting backend server health, verifying external tool availability (ADB, Java, Bundletool), and auditing host system resources.',
    overview: {
      name: 'System Diagnostics',
      description: 'The System Diagnostics page provides real-time health checks on host tools and environment prerequisites. It validates the availability of Android Debug Bridge (`adb`), Java Runtime (`java`), and Google Bundletool, alongside server uptime and memory utilization.',
      whenToUse: 'Check Diagnostics when tests fail to start, when devices are not detected, or when setting up the platform on a new server workstation.',
      example: 'A test pipeline fails at Step 1 "Checking Prerequisites". You open Diagnostics and discover that Java is missing from the host machine\'s PATH.'
    },
    prerequisites: [
      'None. Diagnostics is accessible to all platform users.'
    ],
    steps: [
      {
        step: 1,
        title: 'Open System Diagnostics Tab',
        action: 'Click "System Diagnostics" in the sidebar navigation.'
      },
      {
        step: 2,
        title: 'Check Server Status Card',
        action: 'Review the Server Card: Status must show green "Running", Display Version (e.g. `v1.1 QA`), Uptime (hours/minutes elapsed), and Host platform (Windows / Linux / macOS).'
      },
      {
        step: 3,
        title: 'Inspect External Tools Grid',
        action: 'Review the status of the three mandatory execution tools:\n1. Android Debug Bridge (ADB): Must show green "Available" with version string (e.g. `Android Debug Bridge version 1.0.41`).\n2. Java Development Kit (JDK): Must show green "Available" with version (e.g. `openjdk version 17.0.9`).\n3. Google Bundletool: Must show green "Available" with bundled JAR path and version (e.g. `1.18.3`).'
      },
      {
        step: 4,
        title: 'Check Memory & Resource Metrics',
        action: 'Inspect host Node.js memory metrics: RSS (Resident Set Size), Heap Total, and Heap Used. If Heap Used approaches 90% of Heap Total, recommend a server restart.'
      },
      {
        step: 5,
        title: 'Refresh Diagnostics',
        action: 'Click "Refresh Diagnostics" in the header to re-run all subprocess health checks on demand.'
      }
    ],
    expectedResult: {
      appearance: 'All tool status badges show green "Available" with valid version numbers; server status is green "Running".',
      verification: 'When all tools are green, the global header displays the all-tools-ready indicator.'
    },
    troubleshooting: [
      {
        issue: 'ADB shows "Not Available" in red',
        solution: 'Ensure Android SDK platform-tools is installed on the host and that `adb.exe` is added to the system PATH environment variable.'
      },
      {
        issue: 'Java shows "Not Available" in red',
        solution: 'Install OpenJDK 17 or 21 and ensure `JAVA_HOME` and PATH point to the JDK bin directory.'
      }
    ],
    warnings: [
      'PAD test execution will be automatically blocked if any of the three core tools (ADB, Java, Bundletool) is reported as unavailable.'
    ]
  },

  // 15. ADMIN: USERS & DEVICES
  {
    id: 'admin-users-devices',
    categoryId: 'admin-reference',
    title: '15. Administration: User RBAC & Device Catalog',
    badge: 'Administration',
    summary: 'Managing user accounts, role-based access permissions, admin password resets, hardware device catalog models, and shared custom thumbnail images.',
    overview: {
      name: 'Administration & User Management',
      description: 'Administrative control modules restricted to users with the `ADMIN` role. Encompasses platform user management (RBAC, account deactivation, password resets) and physical device catalog management (device models, hardware specifications, shared custom thumbnail uploads, and controlled server restarts).',
      whenToUse: 'Use these modules when onboarding a new QA team member, resetting forgotten credentials, registering a new lab device model, or uploading custom phone thumbnail pictures.',
      example: 'A new QA intern joins the team. As an Admin, you navigate to User Management, create an account with role `QA_ENGINEER`, and register their new Samsung Galaxy test phone in the Device Catalog with a custom thumbnail image.'
    },
    prerequisites: [
      'Logged-in user account with `ADMIN` role permission.'
    ],
    steps: [
      {
        step: 1,
        title: 'User Management: Create User Account',
        action: 'Navigate to "User Management" in the sidebar. Click "Add User" in the header. Enter Username, Full Name, Email, Temporary Password, and select Role (`ADMIN` or `QA_ENGINEER`). Click "Create Account".'
      },
      {
        step: 2,
        title: 'User Management: Reset Password or Deactivate',
        action: 'In the users table, click the Key icon on any user row to open "Admin Password Reset". Enter a new secure password and click "Reset Password". To temporarily revoke access without deleting data, click the "Active" toggle to set status to Inactive.'
      },
      {
        step: 3,
        title: 'Device Catalog: Add Device Model',
        action: 'Navigate to "Device Management" in the sidebar. Click "Add Device Model". Enter Manufacturer (e.g. `Samsung`), Model Name (e.g. `Galaxy S23 Ultra`), Screen Dimensions, and ABI architecture (`arm64-v8a`). Click Save.'
      },
      {
        step: 4,
        title: 'Device Catalog: Upload Custom Thumbnail Image',
        action: 'In the Device Catalog grid, find the device model and click "Upload Image". Select a clean PNG/JPEG product photo of the device. The image uploads and is immediately shared across all platform users, displaying on device cards on the Dashboard, Devices, and Mirror pages.'
      },
      {
        step: 5,
        title: 'Controlled Server Restart',
        action: 'In Device Management, click "Controlled Backend Restart". Confirm the prompt. The server gracefully flushes databases, releases ports, and reboots in under 3 seconds.'
      }
    ],
    expectedResult: {
      appearance: 'User accounts update immediately in the table; custom device thumbnails appear on device cards across all pages.',
      verification: 'Log in with the newly created user credentials on an incognito browser window to verify access.'
    },
    troubleshooting: [
      {
        issue: 'Access denied: User Management does not appear in sidebar',
        solution: 'Your user account does not have the `ADMIN` role. Contact the platform administrator or database maintainer to elevate your role in SQLite `users` table.'
      },
      {
        issue: 'Custom thumbnail image does not render',
        solution: 'Ensure uploaded image is under 5MB in PNG, JPEG, or WebP format. Verify host has write permissions to `frontend/public/devices` storage directory.'
      }
    ],
    warnings: [
      'Admin password reset takes effect immediately; any active user sessions with the old password will be invalidated on their next API request.',
      'Controlled Backend Restart will abort any automated test pipeline currently in progress.'
    ]
  },

  // 16. KEYBOARD SHORTCUTS
  {
    id: 'shortcuts-cheatsheet',
    categoryId: 'admin-reference',
    title: '16. Global Keyboard Shortcuts & Cheat Sheet',
    badge: 'Shortcuts',
    summary: 'Complete reference of all cross-platform productivity keyboard shortcuts, modal shortcuts, and text-entry suppression safeguards.',
    overview: {
      name: 'Global Keyboard Shortcuts Guide',
      description: 'The platform features built-in global and contextual keyboard shortcuts engineered for high-speed QA productivity. Shortcuts work consistently across Windows, Linux (`Alt` / `Ctrl`), and macOS (`Option` / `Command`) with intelligent editable-field suppression to prevent text disruption.',
      whenToUse: 'Use keyboard shortcuts to rapidly trigger tests, relaunch apps, clear app data, save remote config modifications, and generate bug reports without leaving the keyboard.',
      example: 'While testing on Remote Config Manager, you press Alt + R to relaunch the app on your phone, then Alt + D to clear user data, and Ctrl + Enter to save an updated configuration.'
    },
    prerequisites: [
      'Target Android device selected in global header.'
    ],
    steps: [
      {
        step: 1,
        title: 'Global Test Execution & ADB Action Shortcuts',
        action: 'Available on Run PAD Test, Bug Desk, and Remote Config Manager (when not typing in an input):\n- Alt + Q (macOS Option + Q): Run PAD Test / Start live QA monitoring\n- Alt + R (macOS Option + R): Relaunch application on target device\n- Alt + D (macOS Option + D): Wipe application user & runtime data (pm clear)\n- Alt + C (macOS Option + C): Clear application cache\n- Alt + U (macOS Option + U): Uninstall application from target device'
      },
      {
        step: 2,
        title: 'Form Submission & Generation Shortcuts',
        action: '- Ctrl + Enter (macOS Cmd + Enter) in Edit Remote Config: Validates JSON syntax and submits configuration update immediately.\n- Ctrl + Enter (macOS Cmd + Enter) in Bug Desk New Bug: Analyzes raw notes and generates structured AI bug report.'
      },
      {
        step: 3,
        title: 'Modal & Navigation Dismissal Shortcuts',
        action: '- Escape: Closes any open modal dialog (Create Config, Edit Remote Config, View Full Value, Delete Confirmation, Device Actions dropdown, expanded log viewer).'
      },
      {
        step: 4,
        title: 'Code Editor Navigation Shortcuts',
        action: 'Inside the Synchronized JSON Editor on Remote Config Manager:\n- Tab: Indents code by 2 spaces.\n- Shift + Tab: Unindents code by 2 spaces.'
      },
      {
        step: 5,
        title: 'Understand Editable Field Suppression Rules',
        action: 'To protect you while typing in text inputs (such as Configuration Key input or the JSON code editor), all single-key and Alt-key global shortcuts are automatically suppressed. They will never insert unexpected characters like `®`, `∂`, or `ç` into your code.'
      }
    ],
    expectedResult: {
      appearance: 'Immediate visual action execution with zero cursor jumping or text contamination.',
      verification: 'Pressing Alt + R immediately launches the app and displays a success toast; pressing Escape dismisses any open dialog.'
    },
    troubleshooting: [
      {
        issue: 'Alt + R does not launch app on Remote Config Manager',
        solution: 'Ensure focus is not inside an active text input or textarea. Click on the table or modal background to unfocus text inputs, then press Alt + R.'
      },
      {
        issue: 'Ctrl + Enter does not submit in Edit Remote Config',
        solution: 'Check the error banner at the top of the modal. If JSON syntax is invalid, Ctrl + Enter halts submission to protect you from saving malformed JSON.'
      }
    ],
    warnings: [
      'Holding down shortcut keys does not trigger repeat executions (event.repeat is protected).'
    ]
  },

  // 17. INTERACTIVE QA CHECKLIST
  {
    id: 'qa-checklist',
    categoryId: 'admin-reference',
    title: '17. Interactive QA Sign-Off Acceptance Checklist',
    badge: 'Checklist',
    summary: 'A 10-point interactive acceptance criteria checklist for release sign-off with real-time completion tracking.',
    overview: {
      name: 'Interactive QA Sign-Off Checklist',
      description: 'The interactive QA acceptance checklist guides testers through mandatory verification criteria required before signing off on any candidate release build.',
      whenToUse: 'Complete this checklist at the conclusion of every test cycle before approving a build for production deployment.',
      example: 'Before certifying DesignWiz v2.4.0 for release, you verify that all 10 checklist items (Install-time assets, Fast-follow background downloads, On-demand trigger, zero ANR crashes) are marked complete.'
    },
    prerequisites: [
      'Completed execution of Run PAD Test pipeline on target build.',
      'Exploratory testing verified in Screen Mirror.'
    ],
    steps: [
      {
        step: 1,
        title: 'Review Verification Items',
        action: 'Inspect each of the 10 QA acceptance criteria items listed on the checklist card.'
      },
      {
        step: 2,
        title: 'Perform and Check Off Each Test Case',
        action: 'Check off each item as you verify it on the device:\n1. Wi-Fi / Host Network Subnet Verified\n2. Wireless Debugging Authorized and Stable\n3. AAB Manifest Inspected (Package Name, Versioning, SDKs)\n4. Install-Time Asset Packs Present on First Launch\n5. Fast-Follow Asset Packs Downloaded in Background\n6. On-Demand Asset Packs Downloaded Successfully via PlayCore\n7. Offline Fallback Behavior Handled Gracefully\n8. Asset File Integrity & Checksums Verified\n9. Zero ANRs, Native Crashes, or Memory Leaks\n10. App Data Reset (`pm clear`) Tested and Re-verified'
      },
      {
        step: 3,
        title: 'Verify Progress Metric',
        action: 'Watch the circular QA Sign-Off Progress gauge update from 0% to 100%. All 10 items must be checked for release certification.'
      }
    ],
    expectedResult: {
      appearance: 'Circular gauge reaches 100% with all checkboxes checked in emerald green.',
      verification: 'Checklist state persists across section navigation so you can reference other guides without losing progress.'
    },
    troubleshooting: [
      {
        issue: 'How to reset the checklist for a new testing session?',
        solution: 'Click the "Reset Checklist" button at the bottom of the checklist card to uncheck all items.'
      }
    ],
    warnings: [
      'Do not mark checklist items complete without having actively executed the test step on physical hardware.'
    ]
  }
];
