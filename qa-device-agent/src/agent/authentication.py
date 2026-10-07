"""
Agent Pairing & Authentication Module.
Communicates with Central QA Server pairing endpoint to exchange pairing code for Agent JWT.
"""
import json
import logging
import urllib.request
import urllib.error
import ssl
from .identity import collect_system_info

logger = logging.getLogger("qa_device_agent.auth")


def pair_with_server(server_url, pairing_code, agent_id, agent_name=None, tls_verify=False):
    """
    Exchanges a 6-digit pairing code with the central QA server at /api/agent/pair.
    Returns: (success: bool, result_or_error: dict/str)
    """
    clean_url = server_url.rstrip("/")
    pair_endpoint = f"{clean_url}/api/agent/pair"

    payload = {
        "agentId": agent_id,
        "pairingCode": str(pairing_code).strip(),
        "systemInfo": {
            **collect_system_info(),
            "friendlyName": agent_name or collect_system_info().get("hostname", "QA-Device-Agent")
        }
    }

    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        pair_endpoint,
        data=req_data,
        headers={"Content-Type": "application/json", "User-Agent": "QADeviceAgent/1.0.0"}
    )

    ctx = ssl.create_default_context()
    if not tls_verify:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    try:
        logger.info(f"Connecting to pairing endpoint: {pair_endpoint}")
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            status = resp.status
            body = resp.read().decode("utf-8")
            data = json.loads(body)

            if data.get("success"):
                logger.info(f"Agent successfully paired with server! Bound user: {data.get('user', {}).get('name')}")
                return True, data
            else:
                err = data.get("error", "Pairing rejected by server.")
                logger.error(f"Pairing failed: {err}")
                return False, err

    except urllib.error.HTTPError as e:
        try:
            err_body = json.loads(e.read().decode("utf-8"))
            err_msg = err_body.get("error", str(e))
        except Exception:
            err_msg = str(e)
        logger.error(f"HTTP error during pairing ({e.code}): {err_msg}")
        return False, f"HTTP {e.code}: {err_msg}"
    except Exception as e:
        logger.error(f"Network error during pairing: {e}")
        return False, str(e)


def unpair_from_server(server_url, agent_id, agent_token, tls_verify=False):
    """
    Optionally notifies server that agent is unpairing.
    """
    clean_url = server_url.rstrip("/")
    unpair_endpoint = f"{clean_url}/api/agent/{agent_id}/unpair"

    req = urllib.request.Request(
        unpair_endpoint,
        method="POST",
        headers={
            "Authorization": f"Bearer {agent_token}",
            "Content-Type": "application/json",
            "User-Agent": "QADeviceAgent/1.0.0"
        }
    )

    ctx = ssl.create_default_context()
    if not tls_verify:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    try:
        with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
            return True, "Unpaired successfully."
    except Exception as e:
        logger.warning(f"Unpair notification to server returned: {e}")
        return False, str(e)
