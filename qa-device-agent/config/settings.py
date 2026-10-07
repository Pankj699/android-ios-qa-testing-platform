"""
Configuration and settings management for QA Device Agent.
Persists configuration locally in JSON format in OS-appropriate application data directories.
"""
import os
import sys
import json
import logging

logger = logging.getLogger("qa_device_agent.settings")


def get_default_config_dir():
    """Returns OS-appropriate configuration directory."""
    # 1. Environment variable override
    if os.environ.get("QA_AGENT_HOME"):
        return os.path.abspath(os.environ["QA_AGENT_HOME"])

    # 2. OS-specific standard application data directories
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA") or os.path.expanduser("~\\AppData\\Roaming")
        return os.path.join(appdata, "QA-Device-Agent")
    elif sys.platform == "darwin":
        home = os.path.expanduser("~")
        return os.path.join(home, "Library", "Application Support", "QA-Device-Agent")
    else:
        home = os.path.expanduser("~")
        return os.path.join(home, ".config", "qa-device-agent")


def get_default_config_path():
    """Returns path to the agent configuration JSON file."""
    # 1. Explicit config path override
    if os.environ.get("QA_AGENT_CONFIG"):
        return os.path.abspath(os.environ["QA_AGENT_CONFIG"])

    # 2. Local dev repository fallback (if agent_config.json exists locally)
    local_dev_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "agent_config.json"
    )
    if os.path.exists(local_dev_path):
        return local_dev_path

    # 3. Standard AppData location
    return os.path.join(get_default_config_dir(), "agent_config.json")


def get_default_log_dir():
    """Returns OS-appropriate log directory."""
    if os.environ.get("QA_AGENT_LOG_DIR"):
        return os.path.abspath(os.environ["QA_AGENT_LOG_DIR"])

    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA") or os.path.expanduser("~\\AppData\\Roaming")
        return os.path.join(appdata, "QA-Device-Agent", "logs")
    elif sys.platform == "darwin":
        home = os.path.expanduser("~")
        return os.path.join(home, "Library", "Logs", "QA-Device-Agent")
    else:
        home = os.path.expanduser("~")
        return os.path.join(home, ".local", "state", "qa-device-agent", "logs")


DEFAULT_CONFIG = {
    "agent_id": None,
    "agent_name": None,
    "server_url": "https://localhost:8080",
    "agent_token": None,
    "user_id": None,
    "user_name": None,
    "user_email": None,
    "heartbeat_interval_sec": 15,
    "reconnect_base_delay_sec": 1.0,
    "reconnect_max_delay_sec": 30.0,
    "tls_verify": False,  # Allow self-signed cert in local/dev environments
    "log_level": "INFO"
}


class AgentSettings:
    def __init__(self, config_file=None):
        self.config_file = config_file or get_default_config_path()
        self.data = dict(DEFAULT_CONFIG)
        self.load()

    def load(self):
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                    self.data.update(saved)
            except Exception as e:
                logger.warning(f"Failed to read config from {self.config_file}: {e}")

    def save(self):
        try:
            os.makedirs(os.path.dirname(os.path.abspath(self.config_file)), exist_ok=True)
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2)
            return True
        except Exception as e:
            logger.error(f"Failed to save config to {self.config_file}: {e}")
            return False

    def clear(self):
        self.data = dict(DEFAULT_CONFIG)
        if os.path.exists(self.config_file):
            try:
                os.remove(self.config_file)
            except Exception as e:
                logger.error(f"Failed to delete config file: {e}")

    def get(self, key, default=None):
        return self.data.get(key, default)

    def set(self, key, value):
        self.data[key] = value
        self.save()

    def update(self, **kwargs):
        self.data.update(kwargs)
        self.save()

    @property
    def is_paired(self):
        return bool(self.data.get("agent_token") and self.data.get("agent_id"))
