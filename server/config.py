"""Settings, all from the environment. Nothing secret is ever hardcoded."""
import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

FREE_MODEL = os.environ.get("FREE_MODEL", "claude-haiku-4-5")
PRO_MODEL = os.environ.get("PRO_MODEL", "claude-opus-5")
FREE_DAILY_CALLS = _int("FREE_DAILY_CALLS", 200)
PRO_DAILY_CALLS = _int("PRO_DAILY_CALLS", 2000)

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
MAIL_FROM = os.environ.get("MAIL_FROM", "Focus Coach <login@example.com>")
DEV_ECHO_CODES = os.environ.get("DEV_ECHO_CODES", "0") == "1"

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PRICE_ID = os.environ.get("STRIPE_PRICE_ID", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
BILLING_RETURN_URL = os.environ.get("BILLING_RETURN_URL", "https://example.com/thanks")

DB_PATH = os.environ.get("DB_PATH", "./app.db")

# Auth tuning
CODE_TTL_SECONDS = 10 * 60        # a login code is good for 10 minutes
CODE_MAX_ATTEMPTS = 5             # then it is burned
CODE_COOLDOWN_SECONDS = 60        # min gap between code requests for one email
SESSION_TTL_DAYS = 180            # sign in about twice a year

# Screenshots are a paid feature: they are the expensive part of the bill and
# the most sensitive thing a user can send us.
SCREENSHOT_PLANS = {"pro"}


def plan_model(plan: str) -> str:
    return PRO_MODEL if plan == "pro" else FREE_MODEL


def plan_quota(plan: str) -> int:
    return PRO_DAILY_CALLS if plan == "pro" else FREE_DAILY_CALLS
