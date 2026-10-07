"""
Cross-platform Health and Diagnostics Collector.
"""
import platform
import sys
import os
from .identity import collect_system_info


def get_full_diagnostics():
    """Runs complete platform diagnostics."""
    plat = platform.system()
    diag = {
        "system": collect_system_info(),
        "python_env": {
            "version": sys.version,
            "executable": sys.executable
        },
        "platform_specific": {}
    }

    if plat == "Windows":
        from ..platforms.windows.diagnostics import check_windows_apple_driver
        diag["platform_specific"] = check_windows_apple_driver()
    elif plat == "Darwin":
        from ..platforms.macos.diagnostics import check_macos_usbmux
        diag["platform_specific"] = check_macos_usbmux()

    return diag
