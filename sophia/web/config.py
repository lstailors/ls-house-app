"""
Application settings loaded from environment variables.
Uses pydantic-settings so every variable is validated on startup.
"""

import json
from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # xAI (used for SMS/text completions via grok-2-latest)
    XAI_API_KEY: str

    # OpenAI (used for voice — gpt-4o-realtime-preview)
    OPENAI_API_KEY: str = ""

    # Twilio
    TWILIO_ACCOUNT_SID: str
    TWILIO_AUTH_TOKEN: str
    TWILIO_PHONE_NUMBER: str
    FORWARD_TO_NUMBER: str = ""
    # Verify the X-Twilio-Signature header on inbound webhooks. Leave True in
    # production; set False locally to exercise endpoints with curl.
    VERIFY_TWILIO_SIGNATURE: bool = True

    # ERPNext
    ERPNEXT_URL: str = ""
    ERPNEXT_API_KEY: str = ""
    ERPNEXT_API_SECRET: str = ""

    # Square
    SQUARE_ACCESS_TOKEN: str = ""
    SQUARE_ENVIRONMENT: str = "production"
    SQUARE_LOCATION_ID: str = ""

    # House app bridge (app.lstailors.com backend)
    HOUSE_APP_URL: str = "https://app.lstailors.com"
    SOFIA_BRIDGE_KEY: str = ""

    # Staff
    STAFF_PHONE_NUMBERS: str = ""
    STAFF_DIRECTORY: str = "{}"

    # App
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    BASE_URL: str = "http://localhost:8000"
    LOG_LEVEL: str = "INFO"

    # Dashboard
    DASHBOARD_PORT: int = 8501
    DASHBOARD_PASSWORD: str = "sophia"

    # Runtime toggle — comma-separated tool names; empty = all enabled
    ENABLED_TOOLS: str = ""

    @property
    def enabled_tools(self) -> list[str]:
        if not self.ENABLED_TOOLS.strip():
            return []
        return [t.strip() for t in self.ENABLED_TOOLS.split(",")]

    @property
    def staff_directory(self) -> dict[str, str]:
        try:
            return json.loads(self.STAFF_DIRECTORY)
        except json.JSONDecodeError:
            return {}

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
