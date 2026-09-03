# CLAUDE.md — Focus Coach

Chrome extension (Manifest V3, no build step, no dependencies). Plain ES modules,
loaded unpacked from this directory.

## Commands

There is no build, no test runner, no package.json. To work on it:

- Load/reload: `chrome://extensions` → Developer mode → Load unpacked → this folder,
  then the reload arrow after every edit.
- Syntax check before reloading: `for f in background.js content.js popup.js lib/*.js; do node --check "$f"; done`
- Background logs: `chrome://extensions` → Focus Coach → "service worker" link.

## Architecture

- **`background.js`** — the only stateful component, and it holds no state in memory.
  MV3 kills service workers arbitrarily, so every tick reads `chrome.storage.local`,
  mutates, and writes back; elapsed time always comes from timestamps, never from
  counting ticks. Driven by a 30-second alarm (Chrome's floor) plus `tabs.onActivated`,
  `tabs.onUpdated` and `windows.onFocusChanged` so tab switches react instantly.
- **`content.js`** — pure view. Renders into a shadow root so page CSS and coach CSS
  can't touch each other. Guarded by `window.__focusCoachLoaded` because
  `chrome.scripting.executeScript` is used as a fallback injection path.
- **`popup.*`** — pure view too. Reads state via `GET_STATE`, sends commands, polls
  once a second while open.
- **`lib/`** — `heuristics.js` (free classification), `claude.js` (API call),
  `messages.js` (canned lines).

## Conventions

- Message types are SCREAMING_SNAKE strings; every `chrome.runtime.onMessage` handler
  returns `true` and answers asynchronously.
- Two storage keys only: `settings` and `session`. Defaults live in `DEFAULT_SETTINGS`
  and `BLANK_SESSION` in `background.js` — add new fields there or they won't survive
  a reload.
- Tuning constants (nudge thresholds, milestones, rate limits) are named consts at the
  top of `background.js`. Change behaviour there, not inline.
- Colours: background `#0d1117`, panel `#151b23`, accent green `#22C55E`, alert red
  `#EF4444`. Same palette as FitTrack.

## Claude API notes

- Called with raw `fetch` from the service worker, not the SDK — there's no bundler
  here. Needs the `anthropic-dangerous-direct-browser-access: true` header.
- `output_config.effort` is only sent for models that accept it (not Haiku 4.5), and
  `fallbacks: "default"` + the `server-side-fallback-2026-07-01` beta only for Opus 5.
- `budget_tokens` does not exist on current models — don't add it.
- The call must never be load-bearing: any failure falls back to `heuristics.js` and
  is surfaced in the popup footer.

## The server (`server/`)

FastAPI + SQLite, deployed to the DigitalOcean VPS behind Caddy. Exists purely so
users don't need their own API key. See `server/README.md` for the deploy runbook.

- Auth is email + 6-digit code, no passwords, ever. Tokens and codes are stored as
  SHA-256 hashes; code comparison uses `secrets.compare_digest`.
- **Never store or log page content.** The `/classify` handler logs the exception
  *type* on failure, not the payload. Keep it that way.
- Quota is checked before the Anthropic call, so an over-limit user costs nothing.
- `llm.py` deliberately mirrors `lib/claude.js` — same system prompt, same JSON
  contract. Change one, change the other, or hosted and own-key users get different
  behaviour.
- Model per plan comes from env (`FREE_MODEL` / `PRO_MODEL`), never hardcoded.

## Things to be careful about

- Don't trigger `alert`/`confirm` from the content script; it blocks the page.
- `captureVisibleTab` only works on the focused window's active tab and fails silently
  on `chrome://` pages — the screenshot path already swallows that.
- Alarm periods under 0.5 minutes are ignored by Chrome.
- The extension must reach the API over HTTPS; Let's Encrypt won't issue a cert for
  a bare IP, so the server needs a hostname.
- `.env` and `*.db` are gitignored under `server/`. Never commit a key.
