"""
Windows-specific diagnostic checks for Apple Mobile Device USB Driver and Services.
Provides actionable troubleshooting instructions if prerequisites are missing.
"""
import subprocess
import logging
import os
import sys

logger = logging.getLogger("qa_device_agent.platforms.win")


def check_windows_apple_driver():
    """Checks if Apple Mobile Device USB Driver and Apple Mobile Device Service are active."""
    results = {
        "service_running": False,
        "usb_driver_ok": False,
        "apple_support_installed": False,
        "status": "UNKNOWN",
        "guidance": [],
        "details": {}
    }

    # 1. Check Apple Mobile Device Service via sc query
    try:
        sc_proc = subprocess.run(
            ["sc", "query", "Apple Mobile Device Service"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if "RUNNING" in sc_proc.stdout:
            results["service_running"] = True
            results["details"]["service"] = "RUNNING"
        else:
            results["details"]["service"] = "STOPPED_OR_NOT_FOUND"
    except Exception as e:
        results["details"]["service_error"] = str(e)

    # 2. Check PnP Device for Apple USB Driver via powershell
    try:
        ps_cmd = "Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like '*VID_05AC*' } | Select-Object -Property FriendlyName, Status, InstanceId | ConvertTo-Json"
        ps_proc = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_cmd],
            capture_output=True,
            text=True,
            timeout=8
        )
        if ps_proc.returncode == 0 and "OK" in ps_proc.stdout:
            results["usb_driver_ok"] = True
            results["details"]["apple_pnp_detected"] = True
        else:
            results["details"]["apple_pnp_detected"] = False
    except Exception as e:
        results["details"]["pnp_error"] = str(e)

    # 3. Check Apple Support Directories
    apple_paths = [
        r"C:\Program Files\Common Files\Apple\Mobile Device Support\AppleMobileDeviceService.exe",
        r"C:\Program Files (x86)\Common Files\Apple\Mobile Device Support\AppleMobileDeviceService.exe",
        r"C:\Program Files\WindowsApps\AppleInc.AppleDevices"
    ]
    found_paths = [p for p in apple_paths if os.path.exists(p)]
    if found_paths:
        results["apple_support_installed"] = True
        results["details"]["installed_paths"] = found_paths

    # Evaluate Overall Status
    if results["service_running"] or results["usb_driver_ok"]:
        results["status"] = "READY"
    elif results["apple_support_installed"]:
        results["status"] = "SERVICE_STOPPED"
        results["guidance"].append("Apple Mobile Device Service is installed but stopped. Run 'net start Apple Mobile Device Service' as Administrator.")
    else:
        results["status"] = "MISSING_DRIVERS"
        results["guidance"].append("Apple USB drivers / Apple Mobile Device Support not detected.")
        results["guidance"].append("To fix: Install 'Apple Devices' from Microsoft Store or 'iTunes for Windows' from https://www.apple.com/itunes/")

    return results
