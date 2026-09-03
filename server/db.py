"""SQLite storage. One file, WAL mode, no ORM — this is four tables."""
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    email              TEXT UNIQUE NOT NULL,
    plan               TEXT NOT NULL DEFAULT 'free',
    stripe_customer_id TEXT,
    created_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_codes (
    email      TEXT PRIMARY KEY,
    code_hash  TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
);

-- One row per user per day. We store token counts, never page content.
CREATE TABLE IF NOT EXISTS usage (
    user_id    INTEGER NOT NULL,
    day        TEXT NOT NULL,
    calls      INTEGER NOT NULL DEFAULT 0,
    in_tokens  INTEGER NOT NULL DEFAULT 0,
    out_tokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
"""


def init() -> None:
    Path(config.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)


@contextmanager
def connect():
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def now() -> int:
    return int(time.time())


def today() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


# ------------------------------------------------------------------ users

def upsert_user(email: str) -> sqlite3.Row:
    with connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO users (email, created_at) VALUES (?, ?)",
            (email, now()),
        )
        return conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


def user_by_id(user_id: int):
    with connect() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def set_plan(email: str, plan: str, stripe_customer_id: str | None = None) -> None:
    with connect() as conn:
        if stripe_customer_id:
            conn.execute(
                "UPDATE users SET plan = ?, stripe_customer_id = ? WHERE email = ?",
                (plan, stripe_customer_id, email),
            )
        else:
            conn.execute("UPDATE users SET plan = ? WHERE email = ?", (plan, email))


def user_by_stripe_customer(customer_id: str):
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM users WHERE stripe_customer_id = ?", (customer_id,)
        ).fetchone()


# ------------------------------------------------------------ login codes

def put_code(email: str, code_hash: str) -> None:
    with connect() as conn:
        conn.execute(
            """INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at)
               VALUES (?, ?, ?, 0, ?)
               ON CONFLICT(email) DO UPDATE SET
                   code_hash = excluded.code_hash,
                   expires_at = excluded.expires_at,
                   attempts = 0,
                   created_at = excluded.created_at""",
            (email, code_hash, now() + config.CODE_TTL_SECONDS, now()),
        )


def get_code(email: str):
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM login_codes WHERE email = ?", (email,)
        ).fetchone()


def bump_code_attempts(email: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?", (email,)
        )


def clear_code(email: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM login_codes WHERE email = ?", (email,))


# --------------------------------------------------------------- sessions

def create_session(token_hash: str, user_id: int) -> None:
    ttl = config.SESSION_TTL_DAYS * 86400
    with connect() as conn:
        conn.execute(
            """INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
               VALUES (?, ?, ?, ?, ?)""",
            (token_hash, user_id, now(), now(), now() + ttl),
        )


def session_user(token_hash: str):
    with connect() as conn:
        row = conn.execute(
            """SELECT u.* FROM sessions s
               JOIN users u ON u.id = s.user_id
               WHERE s.token_hash = ? AND s.expires_at > ?""",
            (token_hash, now()),
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?",
                (now(), token_hash),
            )
        return row


def delete_session(token_hash: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))


# ------------------------------------------------------------------ usage

def usage_today(user_id: int) -> int:
    with connect() as conn:
        row = conn.execute(
            "SELECT calls FROM usage WHERE user_id = ? AND day = ?", (user_id, today())
        ).fetchone()
        return row["calls"] if row else 0


def record_call(user_id: int, in_tokens: int, out_tokens: int) -> None:
    with connect() as conn:
        conn.execute(
            """INSERT INTO usage (user_id, day, calls, in_tokens, out_tokens)
               VALUES (?, ?, 1, ?, ?)
               ON CONFLICT(user_id, day) DO UPDATE SET
                   calls = calls + 1,
                   in_tokens = in_tokens + excluded.in_tokens,
                   out_tokens = out_tokens + excluded.out_tokens""",
            (user_id, today(), in_tokens, out_tokens),
        )
