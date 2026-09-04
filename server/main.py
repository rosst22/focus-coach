"""Focus Coach API.

extension -> here (auth + quota) -> Anthropic. The user never holds a key, and
we never store what they were looking at: page text is used for the one call and
then dropped. Only counters are persisted.
"""
import hashlib
import logging
import secrets
import time
from collections import defaultdict, deque

from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field

import config
import db
import llm
import mailer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("focus-coach")

app = FastAPI(title="Focus Coach API", version="1.0.0")

# The extension calls from a chrome-extension:// origin. Nothing else needs in.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    db.init()
    if not config.ANTHROPIC_API_KEY:
        log.warning("ANTHROPIC_API_KEY is not set — /classify will fail")


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


# --------------------------------------------------------- rate limiting
# The unauthenticated endpoints are the abuse surface: someone could use
# /auth/request-code to send mail to strangers. Caddy's rate_limit module is a
# custom build, so the ceiling lives here instead. In-memory is fine because
# the service runs a single worker.
_hits: dict[str, deque] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    # Behind Caddy, request.client.host is always 127.0.0.1.
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "?")


def rate_limit(request: Request, bucket: str, limit: int, window_seconds: int) -> None:
    if len(_hits) > 5000:          # crude guard against unbounded growth
        _hits.clear()
    key = f"{bucket}:{_client_ip(request)}"
    seen = _hits[key]
    cutoff = time.time() - window_seconds
    while seen and seen[0] < cutoff:
        seen.popleft()
    if len(seen) >= limit:
        raise HTTPException(429, "too many requests — wait a few minutes")
    seen.append(time.time())


# ------------------------------------------------------------------- auth

def current_user(authorization: str = Header(default="")):
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "sign in first")
    user = db.session_user(_hash(authorization[7:]))
    if not user:
        raise HTTPException(401, "session expired — sign in again")
    return user


class EmailIn(BaseModel):
    email: EmailStr


class VerifyIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


@app.post("/auth/request-code")
async def request_code(body: EmailIn, request: Request):
    rate_limit(request, "code", limit=10, window_seconds=3600)
    email = body.email.lower()
    existing = db.get_code(email)
    if existing and db.now() - existing["created_at"] < config.CODE_COOLDOWN_SECONDS:
        raise HTTPException(429, "a code was just sent — check your inbox")

    code = f"{secrets.randbelow(1_000_000):06d}"
    db.put_code(email, _hash(code))
    try:
        await mailer.send_code(email, code)
    except Exception:
        db.clear_code(email)
        raise HTTPException(502, "could not send the email — try again in a minute")
    return {"ok": True}


@app.post("/auth/verify")
def verify(body: VerifyIn, request: Request):
    rate_limit(request, "verify", limit=20, window_seconds=3600)
    email = body.email.lower()
    row = db.get_code(email)
    if not row:
        raise HTTPException(400, "ask for a new code")
    if row["expires_at"] < db.now():
        db.clear_code(email)
        raise HTTPException(400, "that code expired — ask for a new one")
    if row["attempts"] >= config.CODE_MAX_ATTEMPTS:
        db.clear_code(email)
        raise HTTPException(429, "too many tries — ask for a new code")

    # Constant-time compare so the endpoint can't be used to guess a code
    # one character at a time.
    if not secrets.compare_digest(row["code_hash"], _hash(body.code)):
        db.bump_code_attempts(email)
        raise HTTPException(400, "wrong code")

    db.clear_code(email)
    user = db.upsert_user(email)
    token = secrets.token_urlsafe(32)
    db.create_session(_hash(token), user["id"])
    return {
        "token": token,
        "email": user["email"],
        "plan": user["plan"],
        "quota": config.plan_quota(user["plan"]),
    }


@app.post("/auth/signout")
def signout(authorization: str = Header(default="")):
    if authorization.startswith("Bearer "):
        db.delete_session(_hash(authorization[7:]))
    return {"ok": True}


@app.get("/me")
def me(user=Depends(current_user)):
    return {
        "email": user["email"],
        "plan": user["plan"],
        "used_today": db.usage_today(user["id"]),
        "quota": config.plan_quota(user["plan"]),
        "model": config.plan_model(user["plan"]),
        "screenshots": user["plan"] in config.SCREENSHOT_PLANS,
    }


# --------------------------------------------------------------- classify

class ClassifyIn(BaseModel):
    goal: str = ""
    tasks: list[str] = []
    title: str = ""
    url: str = ""
    text: str = ""
    # The coach persona. `style` may be free text the user wrote, so it is
    # length-capped here and passed to the model as style guidance only.
    style: str = Field(default="Direct and encouraging.", max_length=400)
    persona_name: str = Field(default="Coach", max_length=40)
    screenshot: str | None = None


@app.post("/classify")
async def classify(body: ClassifyIn, user=Depends(current_user)):
    plan = user["plan"]
    quota = config.plan_quota(plan)
    used = db.usage_today(user["id"])
    if used >= quota:
        raise HTTPException(
            429,
            f"daily limit reached ({quota} checks). The free rules keep working — "
            "the coach just stops asking Claude until tomorrow.",
        )

    # Screenshots are pro-only: they are the expensive half of the bill and the
    # most sensitive thing a user can hand us. Silently ignored on free.
    screenshot = body.screenshot if plan in config.SCREENSHOT_PLANS else None

    try:
        result = await llm.classify(
            model=config.plan_model(plan),
            style=body.style,
            persona_name=body.persona_name,
            goal=body.goal,
            tasks=body.tasks[:20],
            title=body.title[:300],
            url=body.url[:500],
            page_text=body.text[:2000],
            screenshot=screenshot,
        )
    except Exception as err:
        # Log the shape of the failure, never the page content that caused it.
        log.error("classify failed for user %s: %s", user["id"], type(err).__name__)
        raise HTTPException(502, "the coach could not reach Claude — using local rules")

    db.record_call(user["id"], result.pop("in_tokens"), result.pop("out_tokens"))
    result["used_today"] = used + 1
    result["quota"] = quota
    return result


# ---------------------------------------------------------------- billing

def _stripe():
    if not config.STRIPE_SECRET_KEY:
        raise HTTPException(503, "billing is not set up yet")
    import stripe

    stripe.api_key = config.STRIPE_SECRET_KEY
    return stripe


@app.post("/billing/checkout")
def checkout(user=Depends(current_user)):
    stripe = _stripe()
    session = stripe.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": config.STRIPE_PRICE_ID, "quantity": 1}],
        customer_email=user["email"],
        success_url=f"{config.BILLING_RETURN_URL}?ok=1",
        cancel_url=f"{config.BILLING_RETURN_URL}?cancelled=1",
        # Carried through to the webhook so we know which account to upgrade.
        metadata={"email": user["email"]},
    )
    return {"url": session.url}


@app.post("/billing/portal")
def portal(user=Depends(current_user)):
    stripe = _stripe()
    if not user["stripe_customer_id"]:
        raise HTTPException(400, "no subscription on this account")
    session = stripe.billing_portal.Session.create(
        customer=user["stripe_customer_id"], return_url=config.BILLING_RETURN_URL
    )
    return {"url": session.url}


def _plain(value):
    """StripeObject -> plain dict, all the way down.

    construct_event returns StripeObjects, which deliberately implement neither
    .get() nor dict iteration, and the helper for this is named differently
    across stripe-python versions. Converting once here keeps the handler below
    ordinary dict code.
    """
    if hasattr(value, "to_dict"):
        value = value.to_dict()
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return value


@app.post("/webhooks/stripe")
async def stripe_webhook(request: Request, stripe_signature: str = Header(default="")):
    stripe = _stripe()
    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(
            payload, stripe_signature, config.STRIPE_WEBHOOK_SECRET
        )
    except Exception:
        raise HTTPException(400, "bad signature")

    kind = event["type"]
    obj = _plain(event["data"]["object"])

    if kind == "checkout.session.completed":
        email = (obj.get("metadata") or {}).get("email") or obj.get("customer_email")
        if email:
            db.set_plan(email.lower(), "pro", obj.get("customer"))
            log.info("upgraded %s to pro", email)

    elif kind in ("customer.subscription.deleted", "customer.subscription.paused"):
        row = db.user_by_stripe_customer(obj.get("customer"))
        if row:
            db.set_plan(row["email"], "free")
            log.info("downgraded %s to free", row["email"])

    elif kind == "customer.subscription.updated":
        # Covers the states Stripe reports without deleting the subscription:
        # a failed card goes past_due/unpaid, a Checkout-abandoned one stays
        # incomplete. Anything not actively paying drops to free.
        row = db.user_by_stripe_customer(obj.get("customer"))
        if row:
            healthy = obj.get("status") in ("active", "trialing")
            db.set_plan(row["email"], "pro" if healthy else "free")
            log.info("subscription %s -> %s", obj.get("status"), row["email"])

    return {"received": True}


@app.get("/thanks")
def thanks():
    return FileResponse(Path(__file__).parent / "static" / "thanks.html")


@app.get("/health")
def health():
    return {"ok": True, "time": int(time.time())}
