"""Sends the 6-digit sign-in code. Resend's HTTP API, no SDK needed."""
import logging

import httpx2 as httpx

import config

log = logging.getLogger("focus-coach.mail")

TEMPLATE = """<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;max-width:420px;margin:0 auto;padding:28px;color:#111">
  <h2 style="margin:0 0 6px;font-size:18px">Your Focus Coach code</h2>
  <p style="margin:0 0 22px;color:#666;font-size:14px">Paste this into the extension. It expires in 10 minutes.</p>
  <div style="font-size:34px;font-weight:700;letter-spacing:9px;padding:16px;background:#f4f6f8;border-radius:12px;text-align:center">{code}</div>
  <p style="margin:22px 0 0;color:#999;font-size:12px">If you didn't ask for this, ignore it — nobody can sign in without the code.</p>
</div>"""


async def send_code(email: str, code: str) -> None:
    # Dev escape hatch: log the code instead of emailing, so the whole auth flow
    # is testable before Resend is set up.
    if config.DEV_ECHO_CODES or not config.RESEND_API_KEY:
        log.warning("DEV login code for %s: %s", email, code)
        return

    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {config.RESEND_API_KEY}"},
            json={
                "from": config.MAIL_FROM,
                "to": [email],
                "subject": f"{code} is your Focus Coach code",
                "html": TEMPLATE.format(code=code),
            },
        )
        if res.status_code >= 400:
            log.error("resend failed %s: %s", res.status_code, res.text[:300])
            raise RuntimeError("could not send the email")
