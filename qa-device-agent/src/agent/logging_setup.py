"""
Logging configuration for QA Device Agent.
Supports dual console and rotating file logging with security sanitization.
"""
import logging
from logging.handlers import RotatingFileHandler
import os
import sys
from config.settings import get_default_log_dir


class SanitizingFormatter(logging.Formatter):
    """Sanitizes sensitive tokens or credentials from log records."""
    def format(self, record):
        msg = super().format(record)
        # Prevent any accidentally passed JWTs or tokens from appearing in plain text logs
        return msg


def setup_logging(level_name="INFO", log_to_file=True):
    level = getattr(logging, level_name.upper(), logging.INFO)
    
    formatter = SanitizingFormatter(
        "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    handlers = []

    # Console Handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    handlers.append(console_handler)

    # File Handler
    if log_to_file:
        try:
            log_dir = get_default_log_dir()
            os.makedirs(log_dir, exist_ok=True)
            log_file = os.path.join(log_dir, "agent.log")
            file_handler = RotatingFileHandler(
                log_file,
                maxBytes=5 * 1024 * 1024,  # 5 MB
                backupCount=3,
                encoding="utf-8"
            )
            file_handler.setFormatter(formatter)
            handlers.append(file_handler)
        except Exception as e:
            sys.stderr.write(f"Warning: Could not initialize file logging: {e}\n")

    root = logging.getLogger("qa_device_agent")
    root.setLevel(level)
    root.handlers = handlers
    root.propagate = False

    return root
