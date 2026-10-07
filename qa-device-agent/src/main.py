"""
QA Device Agent CLI & Interactive Launcher Entry Point.
Commands:
  (none)    Launch interactive first-run wizard or start paired agent daemon
  pair      Pair agent with Central QA Server using a 6-digit pairing code
  start     Start the Agent background connection, heartbeat, and USB discovery daemon
  devices   Scan and list locally connected physical iOS devices
  status    Show local agent identity and connection configuration
  diagnose  Run local platform, driver, and system diagnostics
  unpair    Unpair agent and remove local configuration
"""
import argparse
import asyncio
import json
import logging
import sys
import os

# Ensure project root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from version import __version__, __installer_version__
from config.settings import AgentSettings, get_default_config_path, get_default_log_dir
from src.agent.identity import generate_agent_id, collect_system_info
from src.agent.authentication import pair_with_server, unpair_from_server
from src.agent.connection import RFC6455Client, WSFrame
from src.agent.heartbeat import HeartbeatManager
from src.agent.device_discovery import DeviceDiscoveryManager, scan_local_ios_devices
from src.agent.command_router import CommandRouter
from src.agent.health import get_full_diagnostics
from src.agent.logging_setup import setup_logging


def print_banner():
    print("========================================================")
    print(f"       QA DEVICE AGENT - v{__version__} (Build {__installer_version__})")
    print("       Cross-Platform iOS USB & Remote Control Agent    ")
    print("========================================================")


def run_first_run_wizard(settings):
    """Interactive first-run configuration and pairing wizard."""
    print_banner()
    print("\n[!] First-Run Setup: Agent is not yet paired with a Central QA Server.\n")

    # Step 1: Run diagnostics & Driver check
    print("[*] Checking local platform prerequisites...")
    diag = get_full_diagnostics()
    plat_spec = diag.get("platform_specific", {})
    status = plat_spec.get("status", "READY")
    if status != "READY":
        print(f"[-] Warning: Platform check status: {status}")
        for g in plat_spec.get("guidance", []):
            print(f"    -> {g}")
    else:
        print("[+] Platform USB & Driver checks: OK")

    # Step 2: Prompt Server URL
    default_url = settings.get("server_url") or "https://localhost:8080"
    print(f"\nEnter Central QA Server URL [default: {default_url}]: ", end="", flush=True)
    try:
        user_url = input().strip()
    except EOFError:
        user_url = ""
    server_url = user_url if user_url else default_url

    # Step 3: Prompt 6-digit pairing code
    print("Enter 6-digit Pairing Code (from QA Platform -> Devices -> Pair Agent): ", end="", flush=True)
    try:
        code = input().strip()
    except EOFError:
        code = ""

    if not code:
        print("[-] Error: Pairing code cannot be empty. Setup aborted.")
        sys.exit(1)

    # Step 4: Prompt optional friendly name
    default_name = collect_system_info().get("hostname", "QA-Workstation")
    print(f"Enter Friendly Agent Name [default: {default_name}]: ", end="", flush=True)
    try:
        user_name = input().strip()
    except EOFError:
        user_name = ""
    name = user_name if user_name else default_name

    agent_id = settings.get("agent_id") or generate_agent_id()

    print(f"\n[*] Pairing Agent {agent_id} with {server_url}...")
    success, res = pair_with_server(
        server_url=server_url,
        pairing_code=code,
        agent_id=agent_id,
        agent_name=name,
        tls_verify=settings.get("tls_verify", False)
    )

    if success:
        user_info = res.get("user", {})
        settings.update(
            agent_id=agent_id,
            agent_name=name,
            server_url=server_url,
            agent_token=res.get("agentToken"),
            user_id=user_info.get("id"),
            user_name=user_info.get("name"),
            user_email=user_info.get("email")
        )
        print(f"\n[+] SUCCESS: Agent successfully paired to {user_info.get('name')} ({user_info.get('email')})!")
        print(f"    Configuration saved to: {settings.config_file}")
        print(f"    Starting Agent connection loop...\n")
        cmd_start(None, settings)
    else:
        print(f"\n[-] PAIRING FAILED: {res}")
        print("Please verify the pairing code and server URL, then try again.")
        sys.exit(1)


def cmd_pair(args, settings):
    server_url = args.server or settings.get("server_url", "https://localhost:8080")
    code = args.code
    name = args.name or collect_system_info().get("hostname", "QA-Device-Agent")

    if not code:
        print("Error: --code <6-digit pairing code> is required.")
        sys.exit(1)

    agent_id = settings.get("agent_id") or generate_agent_id()

    print(f"[*] Pairing Agent {agent_id} with {server_url}...")
    success, res = pair_with_server(
        server_url=server_url,
        pairing_code=code,
        agent_id=agent_id,
        agent_name=name,
        tls_verify=settings.get("tls_verify", False)
    )

    if success:
        user_info = res.get("user", {})
        settings.update(
            agent_id=agent_id,
            agent_name=name,
            server_url=server_url,
            agent_token=res.get("agentToken"),
            user_id=user_info.get("id"),
            user_name=user_info.get("name"),
            user_email=user_info.get("email")
        )
        print(f"[+] SUCCESS: Agent paired successfully!")
        print(f"    Agent ID:   {agent_id}")
        print(f"    Owner User: {user_info.get('name')} ({user_info.get('email')})")
        print(f"    Server:     {server_url}")
    else:
        print(f"[-] FAILED: {res}")
        sys.exit(1)


def cmd_status(args, settings):
    print("========================================")
    print(f"   QA DEVICE AGENT STATUS (v{__version__})")
    print("========================================")
    print(f"Agent ID:     {settings.get('agent_id', 'NOT CONFIGURED')}")
    print(f"Agent Name:   {settings.get('agent_name', 'NOT CONFIGURED')}")
    print(f"Server URL:   {settings.get('server_url', 'NOT CONFIGURED')}")
    print(f"Paired State: {'PAIRED' if settings.is_paired else 'UNPAIRED'}")
    print(f"Owner User:   {settings.get('user_name', 'N/A')} ({settings.get('user_email', 'N/A')})")
    print(f"Owner ID:     {settings.get('user_id', 'N/A')}")
    print(f"Config File:  {settings.config_file}")
    print(f"Log Dir:      {get_default_log_dir()}")
    print("----------------------------------------")
    sys_info = collect_system_info()
    for k, v in sys_info.items():
        print(f"  {k}: {v}")
    print("========================================")


def cmd_devices(args, settings):
    print("[*] Scanning for locally connected physical iOS USB devices...")
    agent_id = settings.get("agent_id") or "AGENT-LOCAL"
    devices = scan_local_ios_devices(agent_id=agent_id)
    print(f"[+] Found {len(devices)} connected iOS device(s):\n")
    for i, d in enumerate(devices, 1):
        print(f"  [{i}] {d['name']} ({d['productType']})")
        print(f"      UDID:        {d['udid']}")
        print(f"      Version:     {d['osVersion']}")
        print(f"      Connection:  {d['connectionType'].upper()}")
        print(f"      Trust:       {d['trustStatus']}")
        if d.get('trustMessage'):
            print(f"      Note:        {d['trustMessage']}")
        print()


def cmd_diagnose(args, settings):
    print("Running system diagnostics...")
    diag = get_full_diagnostics()
    print(json.dumps(diag, indent=2))


def cmd_unpair(args, settings):
    agent_id = settings.get("agent_id")
    token = settings.get("agent_token")
    server_url = settings.get("server_url")

    if agent_id and token and server_url:
        print(f"Notifying server of unpair for {agent_id}...")
        unpair_from_server(server_url, agent_id, token, settings.get("tls_verify", False))

    settings.clear()
    print("[+] Agent configuration cleared. Agent is now UNPAIRED.")


async def run_agent_loop(settings):
    logger = logging.getLogger("qa_device_agent")
    
    if not settings.is_paired:
        logger.error("Agent is not paired! Run 'qa-device-agent pair --code <code>' first.")
        sys.exit(1)

    agent_id = settings.get("agent_id")
    agent_token = settings.get("agent_token")
    server_url = settings.get("server_url")
    heartbeat_interval = settings.get("heartbeat_interval_sec", 15)
    tls_verify = settings.get("tls_verify", False)
    base_delay = settings.get("reconnect_base_delay_sec", 1.0)
    max_delay = settings.get("reconnect_max_delay_sec", 30.0)

    # Transform HTTP server URL to WS URL
    ws_url = server_url.replace("https://", "wss://").replace("http://", "ws://")
    if not ws_url.endswith("/ws/agent"):
        ws_url = f"{ws_url.rstrip('/')}/ws/agent"

    delay = base_delay

    while True:
        client = RFC6455Client(ws_url, agent_id, agent_token, tls_verify=tls_verify)
        heartbeat_mgr = HeartbeatManager(client, interval_sec=heartbeat_interval, get_diagnostics_fn=get_full_diagnostics)
        discovery_mgr = DeviceDiscoveryManager(client, scan_interval_sec=4)
        router = CommandRouter(client, heartbeat_mgr, discovery_mgr=discovery_mgr, diagnostics_fn=get_full_diagnostics)

        try:
            logger.info(f"Connecting to Central QA Server: {ws_url}")
            await client.connect()
            delay = base_delay  # Reset backoff on successful connection
            
            # Start background tasks
            await heartbeat_mgr.start()
            await discovery_mgr.start()

            # Message read loop
            while client.is_connected:
                opcode, payload = await client.read_frame()
                if opcode is None:
                    break

                if opcode == WSFrame.TEXT:
                    await router.route_message(payload)
                elif opcode == WSFrame.PING:
                    await client.send_pong(payload)
                elif opcode == WSFrame.CLOSE:
                    logger.info("Server initiated WebSocket close.")
                    break

        except (ConnectionError, OSError, asyncio.TimeoutError) as e:
            logger.warning(f"Connection lost or unreachable: {e}")
        except Exception as e:
            logger.error(f"Unexpected connection error: {e}", exc_info=True)
        finally:
            await discovery_mgr.stop()
            await heartbeat_mgr.stop()
            await client.close()

        logger.info(f"Reconnecting in {delay:.1f}s...")
        await asyncio.sleep(delay)
        delay = min(delay * 2.0, max_delay)


def cmd_start(args, settings):
    setup_logging(settings.get("log_level", "INFO"))
    print_banner()
    print(f"Starting QA Device Agent daemon (Agent ID: {settings.get('agent_id')})...")
    print(f"Server URL: {settings.get('server_url')}")
    print(f"Owner:      {settings.get('user_name')} ({settings.get('user_email')})")
    print("Press Ctrl+C to stop.\n")
    try:
        asyncio.run(run_agent_loop(settings))
    except KeyboardInterrupt:
        print("\n[!] Agent stopped by user.")


def main():
    parser = argparse.ArgumentParser(
        description="QA Device Agent CLI & Interactive Launcher",
        prog="qa-device-agent"
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument("--interactive", action="store_true", help="Launch interactive setup wizard")
    parser.add_argument("--config", help="Custom path to agent_config.json")

    subparsers = parser.add_subparsers(dest="command", help="Agent command to execute")

    # pair
    p_pair = subparsers.add_parser("pair", help="Pair agent with Central QA Server")
    p_pair.add_argument("--code", required=True, help="6-digit pairing code from Central Web UI")
    p_pair.add_argument("--server", help="Central QA Server URL (e.g. https://localhost:8080)")
    p_pair.add_argument("--name", help="Friendly name for this agent workstation")

    # start
    p_start = subparsers.add_parser("start", help="Start agent background connection daemon")

    # devices
    p_dev = subparsers.add_parser("devices", help="List locally connected physical iOS devices")

    # status
    p_status = subparsers.add_parser("status", help="Display local agent identity & status")

    # diagnose
    p_diag = subparsers.add_parser("diagnose", help="Run local system & USB diagnostics")

    # unpair
    p_unpair = subparsers.add_parser("unpair", help="Unpair agent and clear local credentials")

    args = parser.parse_args()
    settings = AgentSettings(config_file=args.config)

    if args.command == "pair":
        cmd_pair(args, settings)
    elif args.command == "start":
        cmd_start(args, settings)
    elif args.command == "devices":
        cmd_devices(args, settings)
    elif args.command == "status":
        cmd_status(args, settings)
    elif args.command == "diagnose":
        cmd_diagnose(args, settings)
    elif args.command == "unpair":
        cmd_unpair(args, settings)
    elif args.interactive or args.command is None:
        if settings.is_paired and not args.interactive:
            cmd_start(args, settings)
        else:
            run_first_run_wizard(settings)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
