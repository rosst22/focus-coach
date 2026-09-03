// Focus Coach — background service worker.
//
// MV3 service workers get killed whenever Chrome feels like it, so nothing lives
// in memory between ticks: every tick reads state from chrome.storage.local,
// mutates it, and writes it back. Elapsed time is always computed from
// timestamps, never by counting ticks.

import { classify } from "./lib/heuristics.js";
import { pick } from "./lib/messages.js";
import { askClaude } from "./lib/claude.js";
import {
  askBackend,
  requestCode,
  verifyCode,
  me,
  signOut,
  checkoutUrl,
  DEFAULT_API_BASE
} from "./lib/backend.js";

const TICK_ALARM = "focus-coach-tick";
const BILLING_ALARM = "focus-coach-billing-poll";
const TICK_MINUTES = 0.5;              // 30s is the shortest period Chrome allows
const MAX_TICK_DELTA_MS = 90 * 1000;   // ignore gaps bigger than this (laptop slept)
const IDLE_AFTER_SEC = 90;             // no keyboard/mouse for this long = paused
const CLAUDE_MIN_GAP_MS = 60 * 1000;   // never more than one API call a minute

// How long you have to be off-task before each escalation, in ms.
const NUDGE_STEPS = [45_000, 150_000, 330_000];
const NUDGE_REPEAT_MS = 180_000;       // after level 3, re-nudge this often
const RECOVERY_MIN_DRIFT_MS = 45_000;  // only praise a comeback from a real drift
const MILESTONES_MIN = [5, 10, 20, 30, 45, 60, 90, 120];

const DEFAULT_SETTINGS = {
  tone: "hype",                 // hype | calm | coach
  smartMode: false,
  keyMode: "account",           // "account" = our server pays; "own" = user's key
  apiBase: DEFAULT_API_BASE,
  apiKey: "",                   // only used when keyMode === "own"
  model: "claude-opus-5",       // only used when keyMode === "own"
  useScreenshots: false,
  focusSites: [],
  distractSites: [],
  soundOff: true
};

const BLANK_SESSION = {
  active: false,
  goal: "",
  startedAt: 0,
  lastTickAt: 0,
  focusMs: 0,
  driftMs: 0,
  streakStartAt: 0,
  bestStreakMs: 0,
  milestonesHit: [],
  driftSinceAt: 0,
  driftLevel: 0,
  driftLastNudgeAt: 0,
  snoozeUntil: 0,
  tasks: [],
  lastVerdict: "neutral",
  lastReason: "",
  lastPageKey: "",
  lastClaudeAt: 0,
  lastClaudeError: "",
  smartPausedUntil: 0,   // set when the daily quota runs out
  claudeCalls: 0,
  claudeInTokens: 0,
  claudeOutTokens: 0
};

// ---------------------------------------------------------------- storage

const BLANK_AUTH = { token: "", email: "", plan: "free", quota: 0, usedToday: 0 };

async function getAll() {
  const got = await chrome.storage.local.get(["settings", "session", "auth"]);
  return {
    settings: { ...DEFAULT_SETTINGS, ...(got.settings || {}) },
    session: { ...BLANK_SESSION, ...(got.session || {}) },
    auth: { ...BLANK_AUTH, ...(got.auth || {}) }
  };
}

const saveSession = (session) => chrome.storage.local.set({ session });
const saveSettings = (settings) => chrome.storage.local.set({ settings });
const saveAuth = (auth) => chrome.storage.local.set({ auth });

// Routes one classification to whichever brain is configured: our hosted API
// (the default — no key needed) or the user's own Anthropic key.
async function smartVerdict(settings, auth, ctx) {
  if (settings.keyMode === "own") {
    if (!settings.apiKey) throw new Error("no API key set");
    return askClaude({ apiKey: settings.apiKey, model: settings.model, ...ctx });
  }
  if (!auth.token) throw new Error("sign in to use smart mode");
  return askBackend({ apiBase: settings.apiBase || DEFAULT_API_BASE, token: auth.token, ...ctx });
}

// ---------------------------------------------------------------- helpers

const minutes = (ms) => Math.floor(ms / 60000);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function isIdle() {
  return new Promise((resolve) => {
    chrome.idle.queryState(IDLE_AFTER_SEC, (state) => resolve(state !== "active"));
  });
}

// Talk to the content script; inject it first if this tab predates the extension.
async function tellTab(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, payload);
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tabId, payload);
      return true;
    } catch {
      return false; // chrome:// page, PDF viewer, web store — nothing we can inject into
    }
  }
}

async function tabContext(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "COACH_GET_CONTEXT" });
  } catch {
    return null;
  }
}

// Screenshot of the visible tab, shrunk to keep the image token cost down.
async function screenshot(windowId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "jpeg",
      quality: 45
    });
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 1024 / bitmap.width);
    const canvas = new OffscreenCanvas(
      Math.round(bitmap.width * scale),
      Math.round(bitmap.height * scale)
    );
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.6 });
    const buf = new Uint8Array(await out.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i += 1) binary += String.fromCharCode(buf[i]);
    return `data:image/jpeg;base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

async function setBadge(session) {
  if (!session.active) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  if (session.lastVerdict === "drift") {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
    return;
  }
  const streak = session.streakStartAt ? minutes(Date.now() - session.streakStartAt) : 0;
  await chrome.action.setBadgeText({ text: streak ? String(streak) : "•" });
  await chrome.action.setBadgeBackgroundColor({ color: "#22C55E" });
}

async function coach(tabId, payload) {
  if (tabId) await tellTab(tabId, { type: "COACH_SHOW", ...payload });
}

// Stripe confirms the payment to our server, not to the browser, so after we
// send someone to Checkout we poll /me for a couple of minutes to notice.
async function pollBilling() {
  const { settings, auth } = await getAll();
  const { billingPollUntil = 0 } = await chrome.storage.local.get("billingPollUntil");

  if (!auth.token || Date.now() > billingPollUntil) {
    await chrome.alarms.clear(BILLING_ALARM);
    return;
  }
  try {
    const out = await me(settings.apiBase || DEFAULT_API_BASE, auth.token);
    if (out.plan !== auth.plan) {
      await saveAuth({
        token: auth.token,
        email: out.email,
        plan: out.plan,
        quota: out.quota,
        usedToday: out.used_today
      });
      await chrome.alarms.clear(BILLING_ALARM);
      if (out.plan === "pro") {
        const tab = await activeTab();
        await coach(tab?.id, {
          mood: "celebrate",
          text: "Pro is live — Opus 5 and tab screenshots are on.",
          reason: "subscription active"
        });
      }
    }
  } catch {
    /* transient — the next tick tries again */
  }
}

// ---------------------------------------------------------------- the tick

async function tick(trigger = "alarm") {
  const { settings, session, auth } = await getAll();
  if (!session.active) {
    await setBadge(session);
    return;
  }

  const now = Date.now();
  const tab = await activeTab();
  const idle = await isIdle();

  // Time credited to this tick, based on the clock rather than the tick count.
  const delta = session.lastTickAt ? Math.min(now - session.lastTickAt, MAX_TICK_DELTA_MS) : 0;
  session.lastTickAt = now;

  if (idle || !tab || !tab.url) {
    // Away from the keyboard: freeze everything, don't punish the streak.
    await saveSession(session);
    await setBadge(session);
    return;
  }

  const pageKey = `${tab.id}|${tab.url}`;
  const prevPageKey = session.lastPageKey;
  session.lastPageKey = pageKey;
  let result = classify({
    url: tab.url,
    title: tab.title,
    goal: session.goal,
    focusSites: settings.focusSites,
    distractSites: settings.distractSites
  });
  let smartMessage = "";
  let smartCelebrate = false;

  // Ask Claude only when it can actually change the answer: the heuristic is
  // unsure, or we're about to nag. Rate-limited so a long session is cheap.
  const hasCredential = settings.keyMode === "own" ? Boolean(settings.apiKey) : Boolean(auth.token);
  const wantSmart =
    settings.smartMode &&
    hasCredential &&
    now > session.smartPausedUntil &&
    now - session.lastClaudeAt > CLAUDE_MIN_GAP_MS &&
    (!result.confident || result.verdict === "drift" || pageKey !== prevPageKey);

  if (wantSmart) {
    session.lastClaudeAt = now;
    const ctx = await tabContext(tab.id);
    const shot = settings.useScreenshots ? await screenshot(tab.windowId) : null;
    try {
      const verdictFromClaude = await smartVerdict(settings, auth, {
        tone: settings.tone,
        goal: session.goal,
        tasks: session.tasks,
        url: tab.url,
        title: tab.title,
        pageText: ctx?.text || "",
        screenshot: shot
      });
      result = {
        verdict: verdictFromClaude.verdict,
        reason: "Claude looked at the page",
        confident: true
      };
      smartMessage = verdictFromClaude.message;
      smartCelebrate = verdictFromClaude.celebrate;
      session.lastClaudeError = "";
      session.claudeCalls += 1;
      if (verdictFromClaude.usage) {
        session.claudeInTokens += verdictFromClaude.usage.input_tokens || 0;
        session.claudeOutTokens += verdictFromClaude.usage.output_tokens || 0;
      }
      if (verdictFromClaude.usedToday !== undefined) {
        await saveAuth({ ...auth, usedToday: verdictFromClaude.usedToday, quota: verdictFromClaude.quota });
      }
    } catch (err) {
      // Never let an API problem stop the coach — fall back to the free path.
      session.lastClaudeError = String(err.message || err);
      if (err.status === 401) {
        // Session expired server-side: drop the token so the popup prompts a sign-in.
        await saveAuth({ ...BLANK_AUTH });
      } else if (err.status === 429) {
        // Out of quota for the day. Stop asking until UTC midnight; the free
        // heuristics carry the coach in the meantime.
        const midnight = new Date();
        midnight.setUTCHours(24, 0, 0, 0);
        session.smartPausedUntil = midnight.getTime();
      }
    }
  }

  const wasDrifting = session.lastVerdict === "drift";
  const driftFor = session.driftSinceAt ? now - session.driftSinceAt : 0;

  if (result.verdict === "drift") {
    session.driftMs += delta;
    if (session.streakStartAt) {
      session.bestStreakMs = Math.max(session.bestStreakMs, now - session.streakStartAt);
      session.streakStartAt = 0;
    }
    if (!session.driftSinceAt) {
      session.driftSinceAt = now;
      session.driftLevel = 0;
      session.driftLastNudgeAt = 0;
    }

    const off = now - session.driftSinceAt;
    const snoozed = now < session.snoozeUntil;
    if (!snoozed) {
      let level = 0;
      NUDGE_STEPS.forEach((threshold, i) => {
        if (off >= threshold) level = i + 1;
      });
      const dueAgain =
        level === 3 && now - session.driftLastNudgeAt > NUDGE_REPEAT_MS;

      if (level > 0 && (level > session.driftLevel || dueAgain)) {
        session.driftLevel = level;
        session.driftLastNudgeAt = now;
        await coach(tab.id, {
          mood: "nudge",
          level,
          text: smartMessage || pick(settings.tone, `nudge${level}`, { goal: session.goal || "your work" }),
          goal: session.goal,
          reason: result.reason
        });
      }
    }
  } else if (result.verdict === "focus") {
    session.focusMs += delta;
    if (!session.streakStartAt) session.streakStartAt = now;
    session.driftSinceAt = 0;
    session.driftLevel = 0;

    if (wasDrifting && driftFor >= RECOVERY_MIN_DRIFT_MS) {
      await coach(tab.id, {
        mood: "good",
        text: smartMessage || pick(settings.tone, "recovery"),
        reason: result.reason
      });
    } else {
      const streakMin = minutes(now - session.streakStartAt);
      const milestone = MILESTONES_MIN.find(
        (m) => streakMin >= m && !session.milestonesHit.includes(m)
      );
      if (milestone) {
        session.milestonesHit.push(milestone);
        await coach(tab.id, {
          mood: smartCelebrate ? "celebrate" : "good",
          text: smartMessage || pick(settings.tone, "streak", { m: milestone }),
          reason: result.reason
        });
      } else if (smartMessage && smartCelebrate) {
        await coach(tab.id, { mood: "celebrate", text: smartMessage, reason: result.reason });
      } else if (smartMessage && pageKey !== prevPageKey) {
        await coach(tab.id, { mood: "good", text: smartMessage, reason: result.reason });
      }
    }
  } else {
    // Neutral: the clock keeps running on the session but nothing is judged.
    session.driftSinceAt = 0;
    session.driftLevel = 0;
  }

  session.lastVerdict = result.verdict;
  session.lastReason = result.reason;

  // A Claude call can take seconds, during which the user may have ticked a task,
  // edited the goal, hit snooze, or ended the session. Take those fields from
  // storage instead of overwriting them with the copy we read at the top.
  const latest = (await chrome.storage.local.get("session")).session || {};
  if (latest.active === false) return;
  if (latest.tasks) session.tasks = latest.tasks;
  if (latest.goal !== undefined) session.goal = latest.goal;
  session.snoozeUntil = Math.max(session.snoozeUntil, latest.snoozeUntil || 0);

  await saveSession(session);
  await setBadge(session);
}

// ---------------------------------------------------------------- lifecycle

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_MINUTES });
  const { settings } = await getAll();
  await saveSettings(settings);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) tick("alarm");
  if (alarm.name === BILLING_ALARM) pollBilling();
});

// React immediately when the tab changes, so a nudge doesn't wait for the alarm.
chrome.tabs.onActivated.addListener(() => tick("switch"));
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status === "complete" && tab.active) tick("load");
});
chrome.windows.onFocusChanged.addListener((id) => {
  if (id !== chrome.windows.WINDOW_ID_NONE) tick("window");
});

// ---------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const { settings, session } = await getAll();

    switch (msg.type) {
      case "GET_STATE": {
        const streakMs = session.streakStartAt ? Date.now() - session.streakStartAt : 0;
        sendResponse({ settings, session, auth, streakMs });
        break;
      }

      case "START_SESSION": {
        const fresh = {
          ...BLANK_SESSION,
          active: true,
          goal: msg.goal || "",
          startedAt: Date.now(),
          lastTickAt: Date.now(),
          tasks: msg.tasks || session.tasks || []
        };
        await saveSession(fresh);
        await chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_MINUTES });
        await setBadge(fresh);
        tick("start");
        sendResponse({ ok: true });
        break;
      }

      case "STOP_SESSION": {
        const finished = {
          ...session,
          active: false,
          bestStreakMs: Math.max(
            session.bestStreakMs,
            session.streakStartAt ? Date.now() - session.streakStartAt : 0
          ),
          streakStartAt: 0
        };
        await saveSession(finished);
        await setBadge(finished);
        sendResponse({ ok: true, session: finished });
        break;
      }

      case "SAVE_SETTINGS": {
        await saveSettings({ ...settings, ...msg.settings });
        sendResponse({ ok: true });
        break;
      }

      case "UPDATE_GOAL": {
        session.goal = msg.goal || "";
        await saveSession(session);
        sendResponse({ ok: true });
        break;
      }

      case "SET_TASKS": {
        session.tasks = msg.tasks;
        await saveSession(session);
        sendResponse({ ok: true });
        break;
      }

      case "TASK_DONE": {
        // Fired when a task is ticked off — the main "you did a thing" moment.
        const tab = await activeTab();
        if (tab) {
          await coach(tab.id, {
            mood: "celebrate",
            text: pick(settings.tone, "task", { task: msg.text }),
            reason: "task completed"
          });
        }
        sendResponse({ ok: true });
        break;
      }

      case "SNOOZE": {
        session.snoozeUntil = Date.now() + (msg.minutes || 5) * 60000;
        session.driftLevel = 0;
        await saveSession(session);
        sendResponse({ ok: true });
        break;
      }

      case "ACK_NUDGE": {
        // "Okay, back to it" — stop escalating, but keep watching.
        session.driftLevel = 3;
        session.driftLastNudgeAt = Date.now();
        await saveSession(session);
        sendResponse({ ok: true });
        break;
      }

      case "AUTH_REQUEST_CODE": {
        try {
          await requestCode(settings.apiBase || DEFAULT_API_BASE, msg.email);
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: String(err.message || err) });
        }
        break;
      }

      case "AUTH_VERIFY": {
        try {
          const out = await verifyCode(settings.apiBase || DEFAULT_API_BASE, msg.email, msg.code);
          await saveAuth({
            token: out.token,
            email: out.email,
            plan: out.plan,
            quota: out.quota,
            usedToday: 0
          });
          // Signing in is the whole point of smart mode — turn it on.
          await saveSettings({ ...settings, smartMode: true, keyMode: "account" });
          sendResponse({ ok: true, email: out.email, plan: out.plan });
        } catch (err) {
          sendResponse({ ok: false, error: String(err.message || err) });
        }
        break;
      }

      case "AUTH_REFRESH": {
        if (!auth.token) {
          sendResponse({ ok: false, error: "not signed in" });
          break;
        }
        try {
          const out = await me(settings.apiBase || DEFAULT_API_BASE, auth.token);
          await saveAuth({
            token: auth.token,
            email: out.email,
            plan: out.plan,
            quota: out.quota,
            usedToday: out.used_today
          });
          sendResponse({ ok: true, ...out });
        } catch (err) {
          if (err.status === 401) await saveAuth({ ...BLANK_AUTH });
          sendResponse({ ok: false, error: String(err.message || err) });
        }
        break;
      }

      case "AUTH_SIGNOUT": {
        if (auth.token) await signOut(settings.apiBase || DEFAULT_API_BASE, auth.token);
        await saveAuth({ ...BLANK_AUTH });
        sendResponse({ ok: true });
        break;
      }

      case "BILLING_CHECKOUT": {
        try {
          const out = await checkoutUrl(settings.apiBase || DEFAULT_API_BASE, auth.token);
          await chrome.tabs.create({ url: out.url });
          await chrome.storage.local.set({ billingPollUntil: Date.now() + 5 * 60000 });
          await chrome.alarms.create(BILLING_ALARM, { periodInMinutes: 0.5 });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: String(err.message || err) });
        }
        break;
      }

      case "TEST_KEY": {
        try {
          const out = await askClaude({
            apiKey: msg.apiKey,
            model: msg.model,
            tone: settings.tone,
            goal: "testing the extension",
            tasks: [],
            url: "https://example.com",
            title: "Example Domain",
            pageText: "This domain is for use in illustrative examples."
          });
          sendResponse({ ok: true, message: out.message });
        } catch (err) {
          sendResponse({ ok: false, error: String(err.message || err) });
        }
        break;
      }

      default:
        sendResponse({ ok: false, error: `unknown message ${msg.type}` });
    }
  })();
  return true; // keep the message channel open for the async work above
});
