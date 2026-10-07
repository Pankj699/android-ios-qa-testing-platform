"""
macOS-specific diagnostic checks for usbmuxd, CoreDevice, and USB subsystem.
Provides actionable troubleshooting instructions if prerequisites are missing.
"""
import os
import subprocess
import logging

logger = logging.getLogger("qa_device_agent.platforms.macos")


def check_macos_usbmux():
    """Checks if usbmuxd socket and Apple development tools exist on macOS."""
    results = {
        "usbmuxd_socket": False,
        "xcode_tools_installed": False,
        "status": "UNKNOWN",
        "guidance": [],
        "details": {}
    }

    # 1. Check usbmuxd socket
    usbmux_path = "/var/run/usbmuxd"
    if os.path.exists(usbmux_path):
        results["usbmuxd_socket"] = True
        results["details"]["socket"] = usbmux_path
    else:
        results["details"]["socket"] = "NOT_FOUND"

    # 2. Check Xcode Command Line Tools / CoreDevice
    try:
        xcode_proc = subprocess.run(
            ["xcode-select", "-p"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if xcode_proc.returncode == 0:
            results["xcode_tools_installed"] = True
            results["details"]["xcode_path"] = xcode_proc.stdout.strip()
    except Exception as e:
        results["details"]["xcode_error"] = str(e)

    # Evaluate Overall Status
    if results["usbmuxd_socket"]:
        results["status"] = "READY"
    else:
        results["status"] = "USBMUXD_NOT_RUNNING"
        results["guidance"].append("usbmuxd socket was not found. Connect a physical iOS device via USB to start usbmuxd automatically.")
        if not results["xcode_tools_installed"]:
            results["guidance"].append("Xcode Command Line Tools not detected. Run 'xcode-select --install' to install developer utilities.")

    return results
