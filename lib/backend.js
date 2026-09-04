// Talks to the Focus Coach API instead of Anthropic directly, so the user
// never needs a key of their own. Auth is a bearer token from the email-code
// sign-in, stored in chrome.storage.local.

export const DEFAULT_API_BASE = "https://api.rosstoma.me/focuscoach";

async function call(base, path, { method = "POST", token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* a proxy error page, not JSON */
  }

  if (!res.ok) {
    const err = new Error(data.detail || `server error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const requestCode = (base, email) =>
  call(base, "/auth/request-code", { body: { email } });

export const verifyCode = (base, email, code) =>
  call(base, "/auth/verify", { body: { email, code } });

export const me = (base, token) =>
  call(base, "/me", { method: "GET", token });

export const signOut = (base, token) =>
  call(base, "/auth/signout", { token }).catch(() => ({}));

export const checkoutUrl = (base, token) =>
  call(base, "/billing/checkout", { token });

/**
 * Same contract as lib/claude.js askClaude(), so background.js can use either.
 * Throws with `.status` set — 401 means signed out, 429 means out of quota.
 */
export async function askBackend({ apiBase, token, style, personaName, goal, tasks, url, title, pageText, screenshot }) {
  const data = await call(apiBase, "/classify", {
    token,
    body: {
      goal,
      tasks: (tasks || []).filter((t) => !t.done).map((t) => t.text),
      title,
      url,
      text: pageText || "",
      style,
      persona_name: personaName,
      screenshot: screenshot || null
    }
  });
  return {
    verdict: data.verdict,
    message: data.message,
    celebrate: Boolean(data.celebrate),
    usedToday: data.used_today,
    quota: data.quota,
    usage: null
  };
}
