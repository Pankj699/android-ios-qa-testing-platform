"""
Agent Command Executor.
Enforces strict allowlist validation and executes approved device operations on local iOS devices.
No arbitrary shell, executable paths, or command strings are allowed.
"""
import asyncio
import inspect
import logging
import re
import time

logger = logging.getLogger("qa_device_agent.executor")

# Explicit allowlist of supported commands
COMMAND_ALLOWLIST = {
    "DEVICE_INFO",
    "APP_LAUNCH",
    "APP_TERMINATE",
    "SYSLOG"
}

# Strict bundle identifier pattern (e.g. com.apple.Preferences, com.example.app)
BUNDLE_ID_REGEX = re.compile(r"^[a-zA-Z0-9]+(\.[a-zA-Z0-9_-]+)+$")


def validate_bundle_id(bundle_id: str) -> bool:
    """Validates bundle identifier format to prevent injection or invalid input."""
    if not bundle_id or not isinstance(bundle_id, str):
        return False
    if len(bundle_id) > 255:
        return False
    # Check for shell metacharacters, whitespace, or path traversal
    if any(c in bundle_id for c in (";", "&", "|", "`", "$", "\n", "\r", "..", "/", "\\", " ", "\t")):
        return False
    return bool(BUNDLE_ID_REGEX.match(bundle_id))


async def exec_device_info(udid: str, args: dict) -> dict:
    """Queries lockdown and diagnostics services for deep device information."""
    try:
        from pymobiledevice3.lockdown import create_using_usbmux
        lock_res = create_using_usbmux(serial=udid)
        lockdown = await lock_res if inspect.isawaitable(lock_res) else lock_res

        val_res = lockdown.get_value()
        all_values = await val_res if inspect.isawaitable(val_res) else val_res
        all_values = all_values or {}

        # Query battery
        battery_data = {}
        try:
            bat_res = lockdown.get_value(domain="com.apple.mobile.battery")
            bat = await bat_res if inspect.isawaitable(bat_res) else bat_res
            if bat:
                battery_data = {
                    "level": bat.get("BatteryCurrentCapacity"),
                    "isCharging": bat.get("BatteryIsCharging", False),
                    "externalConnected": bat.get("ExternalConnected", False)
                }
        except Exception:
            pass

        # Query storage
        storage_data = {}
        try:
            disk_res = lockdown.get_value(domain="com.apple.disk_usage")
            disk = await disk_res if inspect.isawaitable(disk_res) else disk_res
            if disk:
                total_bytes = disk.get("TotalDiskCapacity", 0)
                free_bytes = disk.get("TotalDataAvailable", 0)
                storage_data = {
                    "totalBytes": total_bytes,
                    "freeBytes": free_bytes,
                    "totalGb": round(total_bytes / (1024**3), 2) if total_bytes else 0,
                    "freeGb": round(free_bytes / (1024**3), 2) if free_bytes else 0
                }
        except Exception:
            pass

        return {
            "udid": udid,
            "name": all_values.get("DeviceName") or all_values.get("UserAssignedDeviceName") or "iPhone",
            "productType": all_values.get("ProductType") or "iPhone",
            "productVersion": all_values.get("ProductVersion") or "Unknown",
            "buildVersion": all_values.get("BuildVersion") or "Unknown",
            "modelNumber": all_values.get("ModelNumber") or "Unknown",
            "serialNumber": all_values.get("SerialNumber") or "Unknown",
            "developerMode": bool(all_values.get("DeveloperModeStatus", False)),
            "battery": battery_data,
            "storage": storage_data,
            "timestamp": int(time.time() * 1000)
        }

    except Exception as e:
        raise RuntimeError(f"DEVICE_INFO failed: {e}")


async def exec_app_launch(udid: str, args: dict) -> dict:
    """Launches an approved application via ProcessControl or Springboard."""
    bundle_id = args.get("bundleId")
    if not validate_bundle_id(bundle_id):
        raise ValueError(f"Invalid bundle identifier format: {bundle_id}")

    try:
        from pymobiledevice3.lockdown import create_using_usbmux
        from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
        from pymobiledevice3.services.dvt.instruments.process_control import ProcessControl

        lock_res = create_using_usbmux(serial=udid)
        lockdown = await lock_res if inspect.isawaitable(lock_res) else lock_res

        # Attempt launch using DvtProvider & ProcessControl
        async with DvtProvider(lockdown) as dvt:
            async with ProcessControl(dvt) as process_control:
                pid = await process_control.launch(bundle_id=bundle_id, kill_existing=True)
                return {
                    "bundleId": bundle_id,
                    "pid": pid,
                    "status": "launched",
                    "timestamp": int(time.time() * 1000)
                }

    except Exception as e:
        raise RuntimeError(f"APP_LAUNCH failed for {bundle_id}: {e}")


async def exec_app_terminate(udid: str, args: dict) -> dict:
    """Terminates an application by bundleId or PID via ProcessControl."""
    bundle_id = args.get("bundleId")
    pid = args.get("pid")

    if bundle_id and not validate_bundle_id(bundle_id):
        raise ValueError(f"Invalid bundle identifier format: {bundle_id}")

    if not bundle_id and not pid:
        raise ValueError("Either bundleId or pid is required to terminate an application.")

    try:
        from pymobiledevice3.lockdown import create_using_usbmux
        from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
        from pymobiledevice3.services.dvt.instruments.process_control import ProcessControl

        lock_res = create_using_usbmux(serial=udid)
        lockdown = await lock_res if inspect.isawaitable(lock_res) else lock_res

        async with DvtProvider(lockdown) as dvt:
            async with ProcessControl(dvt) as process_control:
                target_pid = pid
                if not target_pid and bundle_id:
                    target_pid = await process_control.process_identifier_for_bundle_identifier(bundle_id)

                if not target_pid:
                    return {
                        "bundleId": bundle_id,
                        "pid": None,
                        "status": "not_running",
                        "message": "Process was not currently running on device."
                    }

                await process_control.kill(target_pid)
                return {
                    "bundleId": bundle_id,
                    "pid": target_pid,
                    "status": "terminated",
                    "timestamp": int(time.time() * 1000)
                }

    except Exception as e:
        raise RuntimeError(f"APP_TERMINATE failed: {e}")


async def exec_syslog(udid: str, args: dict) -> dict:
    """Captures a bounded slice of live syslog entries with strict timeout and line limit."""
    max_lines = min(int(args.get("maxLines", 50)), 100)
    duration_sec = min(float(args.get("durationSec", 2.0)), 3.0)

    try:
        from pymobiledevice3.lockdown import create_using_usbmux
        from pymobiledevice3.services.syslog import SyslogService

        lock_res = create_using_usbmux(serial=udid)
        lockdown = await lock_res if inspect.isawaitable(lock_res) else lock_res

        logs = []
        start_time = time.time()

        async with SyslogService(lockdown) as syslog:
            async for entry in syslog.watch():
                if isinstance(entry, bytes):
                    line = entry.decode("utf-8", errors="ignore").strip()
                else:
                    line = str(entry).strip()

                if line:
                    logs.append(line)

                if len(logs) >= max_lines or (time.time() - start_time) >= duration_sec:
                    break

        return {
            "udid": udid,
            "logs": logs,
            "count": len(logs),
            "durationSec": round(time.time() - start_time, 2)
        }

    except Exception as e:
        raise RuntimeError(f"SYSLOG failed: {e}")


async def execute_command(command: str, device_id: str, args: dict = None) -> tuple:
    """
    Validates and dispatches approved commands.
    Returns: (success: bool, result: dict, error: dict)
    """
    args = args or {}

    # 1. Allowlist Check
    if command not in COMMAND_ALLOWLIST:
        return False, None, {
            "code": "COMMAND_NOT_SUPPORTED",
            "message": f"Command '{command}' is not in the approved Agent allowlist."
        }

    # 2. Device ID Check
    if not device_id or not isinstance(device_id, str):
        return False, None, {
            "code": "INVALID_DEVICE_ID",
            "message": "Target deviceId (UDID) is required."
        }

    logger.info(f"Executing command {command} on device {device_id} with args: {args}")

    try:
        if command == "DEVICE_INFO":
            res = await exec_device_info(device_id, args)
        elif command == "APP_LAUNCH":
            res = await exec_app_launch(device_id, args)
        elif command == "APP_TERMINATE":
            res = await exec_app_terminate(device_id, args)
        elif command == "SYSLOG":
            res = await exec_syslog(device_id, args)
        else:
            return False, None, {"code": "UNHANDLED_COMMAND", "message": f"Unhandled command {command}"}

        return True, res, None

    except ValueError as ve:
        logger.warning(f"Validation error executing {command}: {ve}")
        return False, None, {
            "code": "INVALID_ARGUMENT",
            "message": str(ve)
        }
    except Exception as e:
        logger.error(f"Execution error executing {command} on {device_id}: {e}")
        return False, None, {
            "code": "EXECUTION_ERROR",
            "message": str(e)
        }
