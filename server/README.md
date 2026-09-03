# Focus Coach API

The backend that lets people use Focus Coach without an Anthropic key. The
extension sends what's on screen, this server checks who they are and whether
they have quota left, calls Claude with **your** key, and sends back a verdict.

```
extension ──▶ this server ──▶ Anthropic
              │
              └── SQLite: users, sessions, daily counters
```

## What it does and doesn't store

Stored: email, plan, session token hash, and per-day counters (calls, token
counts). **Not stored:** page text, page titles, URLs, or screenshots. Those
exist for the duration of one request and are never written to disk or logged —
error logs record the exception type, never the content that caused it.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/request-code` | — | Email a 6-digit code (60s cooldown per address) |
| POST | `/auth/verify` | — | Exchange the code for a 180-day bearer token |
| POST | `/auth/signout` | bearer | Delete the session |
| GET | `/me` | bearer | Plan, quota, calls used today |
| POST | `/classify` | bearer | The actual coaching call |
| POST | `/billing/checkout` | bearer | Stripe Checkout URL |
| POST | `/billing/portal` | bearer | Stripe customer portal URL |
| POST | `/webhooks/stripe` | signature | Flips a user between `free` and `pro` |
| GET | `/thanks` | — | Post-checkout page (also handles the cancelled case) |
| GET | `/health` | — | Liveness |

## Plans

| | Free | Pro |
| --- | --- | --- |
| Model | Haiku 4.5 | Opus 5 |
| Calls/day | 200 | 2000 |
| Screenshots | no | yes |

Both numbers and both models are env vars — change them without touching code.
Quota is checked *before* the Anthropic call, so an exhausted user costs nothing.
When a user runs out, the extension falls back to its free local rules for the
rest of the day rather than breaking.

## Run it locally

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
cp .env.example .env          # fill in ANTHROPIC_API_KEY
DEV_ECHO_CODES=1 DB_PATH=./app.db ./.venv/bin/uvicorn main:app --port 8931 --reload
```

`DEV_ECHO_CODES=1` prints the login code to the console instead of emailing it,
so you can test the whole sign-in flow before Resend is configured.

Point the extension at it: popup → Settings → Advanced → API server →
`http://localhost:8931`.

## Deployed at

`https://api.rosstoma.me/focuscoach` — on `ross-server`, behind the Caddy that
already serves rosstoma.me, FitTrack and Post Streak.

That host was already taken by FitTrack, and there is no wildcard DNS on
rosstoma.me, so Focus Coach is mounted at a **path prefix** the same way Post
Streak is. `handle_path` strips it, so `/focuscoach/health` reaches the app as
`/health`. No DNS record was needed.

| | |
| --- | --- |
| Code | `/opt/focus-coach` (a clone of this repo) |
| Runs as | `focuscoach` (non-root — unlike the other services on the box) |
| Binds | `127.0.0.1:8080` (8000 = FitTrack, 8001 = Post Streak) |
| Database | `/var/lib/focus-coach/app.db` |
| Secrets | `/opt/focus-coach/server/.env`, mode 600 |
| Logs | `journalctl -u focus-coach-api -f` |

### Deploying it somewhere else

```bash
adduser --system --group --home /opt/focus-coach --no-create-home focuscoach
mkdir -p /var/lib/focus-coach && chown focuscoach:focuscoach /var/lib/focus-coach
git clone https://github.com/rosst22/focus-coach /opt/focus-coach
cd /opt/focus-coach/server
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
cp .env.example .env && nano .env
chmod 600 .env && chown -R focuscoach:focuscoach /opt/focus-coach
cp deploy/focus-coach-api.service /etc/systemd/system/
systemctl enable --now focus-coach-api
```

Then put the `handle_path` block from `deploy/Caddyfile` inside your existing
site block — **do not replace `/etc/caddy/Caddyfile`**, other apps live in it.
`caddy validate --config /etc/caddy/Caddyfile` before `systemctl reload caddy`.

Note: `rate_limit` is a custom-build Caddy module and is not in the apt build.
Rate limiting is done in the app instead (10 code requests / 20 verifies per IP
per hour).

### Updating

```bash
cd /opt/focus-coach && git pull && chown -R focuscoach:focuscoach /opt/focus-coach
systemctl restart focus-coach-api
```

The files are owned by `focuscoach` but you pull as root, which git refuses by
default. Already configured on this box; on a fresh one you need it once:

```bash
git config --global --add safe.directory /opt/focus-coach
```

### Signing in before Resend is configured

With `RESEND_API_KEY` blank the codes go to the journal instead of an inbox,
which means only someone with server access can sign in — a usable private beta:

```bash
journalctl -u focus-coach-api --since "2 minutes ago" | grep "DEV login code"
```

## Billing (optional — everything else works without it)

1. Stripe → create a recurring Price, copy its `price_...` id into `STRIPE_PRICE_ID`
2. Stripe → Developers → Webhooks → add `https://api.yourdomain.com/webhooks/stripe`,
   subscribe to `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `customer.subscription.paused`; copy the signing
   secret into `STRIPE_WEBHOOK_SECRET`
3. Set `BILLING_RETURN_URL=https://api.yourdomain.com/thanks` — the server hosts that
   page itself, so there is nothing else to deploy
4. Put the secret key in `STRIPE_SECRET_KEY` and restart

Plan changes are driven **only** by webhooks, never by the browser returning from
Checkout — a user can't upgrade themselves by visiting a URL. `customer.subscription.updated`
is handled too, so a failed card (`past_due`) drops the account to free and a fixed
card restores it without anyone touching the database.

Leave those blank and the billing routes return 503 while the rest of the API
runs normally.

## Cost control

Three layers, cheapest first:

1. The extension only calls at all when its local rules are unsure, and never
   more than once a minute per user.
2. This server rejects over-quota users before spending a token.
3. Caddy rate-limits by IP in front of both.

Watch what it's costing you:

```sql
-- daily spend by tokens, per user
SELECT day, SUM(calls), SUM(in_tokens), SUM(out_tokens) FROM usage GROUP BY day;
```
