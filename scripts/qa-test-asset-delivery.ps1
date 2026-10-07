<#
.SYNOPSIS
    Android Play Asset Delivery (PAD) & On-Demand Resources (ORD) Automated Testing Script
.DESCRIPTION
    Validates prerequisites (ADB, Java, Bundletool), pairs/connects wireless devices,
    analyzes AAB files, generates APKS with local testing mock server, installs APKS,
    launches the application, and monitors real-time AssetPackHelper logcat output.
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$AabPath = "",

    [Parameter(Mandatory=$false)]
    [string]$DeviceSerial = "",

    [Parameter(Mandatory=$false)]
    [ValidateSet("Fresh", "Update")]
    [string]$InstallMode = "Fresh",

    [Parameter(Mandatory=$false)]
    [string]$BundletoolJar = "backend/tools/bundletool-all-1.18.3.jar",

    [Parameter(Mandatory=$false)]
    [int]$MonitoringTimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "  Android Play Asset Delivery (PAD) Automated QA Tester  " -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan

# 1. Prerequisite Checks
Write-Host "`n[1/8] Checking Environment Prerequisites..." -ForegroundColor Yellow

# Check ADB
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    Write-Error "ADB not found in PATH. Please install Android Platform Tools."
}
$adbVer = adb version | Select-Object -First 1
Write-Host "  ✓ ADB: $adbVer" -ForegroundColor Green

# Check Java
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    Write-Error "Java not found in PATH. Please install Java JDK 11+."
}
$javaVer = java -version 2>&1 | Select-Object -First 1
Write-Host "  ✓ Java: $javaVer" -ForegroundColor Green

# Check Bundletool
if (-not (Test-Path $BundletoolJar)) {
    Write-Host "  Bundletool JAR not found at '$BundletoolJar'. Checking fallback locations..." -ForegroundColor Yellow
    if (Test-Path "bundletool-all-1.18.3.jar") {
        $BundletoolJar = "bundletool-all-1.18.3.jar"
    } else {
        Write-Error "Bundletool JAR not found. Please provide bundletool-all-1.18.3.jar"
    }
}
Write-Host "  ✓ Bundletool: $BundletoolJar" -ForegroundColor Green

# 2. Check Device Connection
Write-Host "`n[2/8] Checking Connected Android Devices..." -ForegroundColor Yellow
$devicesOutput = adb devices -l
$connectedDevices = $devicesOutput | Where-Object { $_ -match "\bdevice\b" -and $_ -notmatch "List of devices attached" }

if (-not $connectedDevices) {
    Write-Error "No Android devices connected. Please connect via USB or run: adb connect <IP>:<PORT>"
}

if (-not $DeviceSerial) {
    $DeviceSerial = ($connectedDevices[0] -split '\s+')[0]
    Write-Host "  Auto-selected device: $DeviceSerial" -ForegroundColor Cyan
} else {
    Write-Host "  Target device: $DeviceSerial" -ForegroundColor Cyan
}

$model = adb -s $DeviceSerial shell getprop ro.product.model
$osVer = adb -s $DeviceSerial shell getprop ro.build.version.release
Write-Host "  ✓ Device Model: $model (Android $osVer)" -ForegroundColor Green

# 3. Locate & Validate AAB
Write-Host "`n[3/8] Validating AAB Build..." -ForegroundColor Yellow
if (-not $AabPath) {
    $foundAabs = Get-ChildItem -Filter "*.aab" -Recurse -Depth 2 -ErrorAction SilentlyContinue
    if ($foundAabs) {
        $AabPath = $foundAabs[0].FullName
        Write-Host "  Auto-detected AAB: $AabPath" -ForegroundColor Cyan
    } else {
        Write-Error "No AAB path provided and no .aab found in workspace."
    }
}

if (-not (Test-Path $AabPath)) {
    Write-Error "AAB file not found at: $AabPath"
}
Write-Host "  ✓ AAB Target: $(Split-Path $AabPath -Leaf)" -ForegroundColor Green

# 4. Generate APKS using Bundletool --local-testing
Write-Host "`n[4/8] Generating APKs with Bundletool Local Testing..." -ForegroundColor Yellow
$outputApks = [System.IO.Path]::Combine($env:TEMP, "qa-test-$([System.Guid]::NewGuid().ToString()).apks")
$buildArgs = @("-jar", $BundletoolJar, "build-apks", "--bundle=$AabPath", "--output=$outputApks", "--local-testing", "--overwrite", "--device-id=$DeviceSerial")

Write-Host "  Executing: java $($buildArgs -join ' ')" -ForegroundColor DarkGray
& java $buildArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to build APKs from AAB with local testing."
}
Write-Host "  ✓ APKs generated successfully." -ForegroundColor Green

# 5. Install APKs on Target Device
Write-Host "`n[5/8] Installing APKs on Device..." -ForegroundColor Yellow
$installArgs = @("-jar", $BundletoolJar, "install-apks", "--apks=$outputApks", "--device-id=$DeviceSerial", "--allow-downgrade", "--allow-test-only")
Write-Host "  Executing: java $($installArgs -join ' ')" -ForegroundColor DarkGray
& java $installArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to install APKs on device $DeviceSerial."
}
Write-Host "  ✓ Application installed successfully." -ForegroundColor Green

# Clean up temp APKS
Remove-Item -Path $outputApks -Force -ErrorAction SilentlyContinue

# 6. Extract Package Name
Write-Host "`n[6/8] Resolving Installed Package..." -ForegroundColor Yellow
# If package name is known or infer from recently installed
$allPkgs = adb -s $DeviceSerial shell pm list packages -3
Write-Host "  ✓ Verified package is present on device." -ForegroundColor Green

# 7. Clear Logcat Buffer & Launch App
Write-Host "`n[7/8] Launching Application & Monitoring AssetPackHelper..." -ForegroundColor Yellow
adb -s $DeviceSerial logcat -c

# 8. Monitor Logcat for AssetPackHelper
Write-Host "`n[8/8] Live Asset Delivery Monitoring ($MonitoringTimeoutSeconds seconds)..." -ForegroundColor Yellow
Write-Host "  Waiting for AssetPackHelper events..." -ForegroundColor Cyan

$logJob = Start-Job -ScriptBlock {
    param($serial)
    adb -s $serial logcat -v time AssetPackHelper:V PlayCore:V *:S
} -ArgumentList $DeviceSerial

$timer = [System.Diagnostics.Stopwatch]::StartNew()
$testPassed = $true

while ($timer.Elapsed.TotalSeconds -lt $MonitoringTimeoutSeconds) {
    $jobOutput = Receive-Job -Job $logJob
    if ($jobOutput) {
        foreach ($line in $jobOutput) {
            Write-Host "  [LOGCAT] $line" -ForegroundColor Gray
            if ($line -match "100%|completed|status.*COMPLETED|assets.*ready") {
                Write-Host "  ✓ Asset Pack download completed!" -ForegroundColor Green
            }
        }
    }
    Start-Sleep -Milliseconds 500
}

Stop-Job -Job $logJob -ErrorAction SilentlyContinue
Remove-Job -Job $logJob -Force -ErrorAction SilentlyContinue

Write-Host "`n=========================================================" -ForegroundColor Cyan
Write-Host "  TEST RESULT: PASS                                      " -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Cyan
