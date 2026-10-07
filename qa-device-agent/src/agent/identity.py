"""
Agent Identity and System Metadata Collector.
Generates unique, deterministic or persistent Agent IDs and collects system information.
"""
import os
import platform
import socket
import uuid
import sys


def get_machine_identifier():
    """Returns a persistent machine UUID or hostname hash."""
    try:
        node = uuid.getnode()
        return f"{node:012x}"
    except Exception:
        return uuid.uuid4().hex[:12]


def generate_agent_id():
    """Generates a structured Agent ID: AGENT-<PLATFORM>-<SHORT_HEX>."""
    plat = platform.system().upper()
    if plat == "DARWIN":
        plat = "MACOS"
    elif plat == "WINDOWS":
        plat = "WIN"
    else:
        plat = "LINUX"
    
    unique_part = get_machine_identifier()[:8].upper()
    return f"AGENT-{plat}-{unique_part}"


def collect_system_info():
    """Gathers sanitized, non-sensitive platform and environment information."""
    plat = platform.system()
    if plat == "Darwin":
        os_name = "macOS"
    elif plat == "Windows":
        os_name = "Windows"
    else:
        os_name = plat

    hostname = socket.gethostname()
    os_version = platform.version()
    os_release = platform.release()
    arch = platform.machine()
    python_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"

    return {
        "os": os_name,
        "os_version": os_version,
        "os_release": os_release,
        "architecture": arch,
        "hostname": hostname,
        "python_version": python_ver,
        "platform_details": platform.platform()
    }
