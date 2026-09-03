// Popup UI. Holds no state of its own — it reads from the background worker,
// sends messages back, and re-renders once a second while it's open.

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

let state = null;
let tasks = [];

const fmt = (ms) => {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m}m`;
};

function renderTasks() {
  const ul = $("tasks");
  ul.innerHTML = "";
  tasks.forEach((task, i) => {
    const li = document.createElement("li");
    if (task.done) li.className = "done";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = task.done;
    box.addEventListener("change", () => {
      tasks[i].done = box.checked;
      send({ type: "SET_TASKS", tasks });
      if (box.checked) send({ type: "TASK_DONE", text: task.text });
      renderTasks();
    });

    const label = document.createElement("span");
    label.textContent = task.text;

    const del = document.createElement("button");
    del.textContent = "×";
    del.title = "remove";
    del.addEventListener("click", () => {
      tasks.splice(i, 1);
      send({ type: "SET_TASKS", tasks });
      renderTasks();
    });

    li.append(box, label, del);
    ul.appendChild(li);
  });
}

function renderSettings(s) {
  $("tone").value = s.tone;
  $("smartMode").checked = s.smartMode;
  $("keyMode").checked = s.keyMode === "own";
  $("apiKey").value = s.apiKey;
  $("model").value = s.model;
  $("apiBase").value = s.apiBase || "";
  $("useScreenshots").checked = s.useScreenshots;
  $("focusSites").value = (s.focusSites || []).join("\n");
  $("distractSites").value = (s.distractSites || []).join("\n");
  $("ownKeyBox").style.display = s.keyMode === "own" ? "block" : "none";
}

function renderAccount(auth) {
  const signedIn = Boolean(auth.token);
  $("signedIn").style.display = signedIn ? "block" : "none";
  $("signedOut").style.display = signedIn ? "none" : "block";
  if (!signedIn) return;

  $("acctEmail").textContent = auth.email;
  $("acctPlan").textContent = auth.plan;
  $("acctPlan").className = `pill${auth.plan === "pro" ? " pro" : ""}`;
  $("acctUsage").textContent = auth.quota
    ? `${auth.usedToday} / ${auth.quota} smart checks used today`
    : "";
  $("upgrade").style.display = auth.plan === "pro" ? "none" : "block";
}

async function refresh(full = false) {
  state = await send({ type: "GET_STATE" });
  const { session, settings, auth, streakMs } = state;

  $("statFocus").textContent = fmt(session.focusMs);
  $("statDrift").textContent = fmt(session.driftMs);
  $("statStreak").textContent = fmt(streakMs);

  $("dot").className = `dot ${
    session.active ? (session.lastVerdict === "drift" ? "drift" : "on") : ""
  }`;
  $("verdict").textContent = session.active
    ? session.lastVerdict === "drift"
      ? "off task"
      : session.lastVerdict === "focus"
      ? "on task"
      : "watching"
    : "paused";

  $("toggle").textContent = session.active ? "End session" : "Start session";
  $("toggle").className = `primary wide${session.active ? " stop" : ""}`;

  const bits = [];
  if (session.lastReason) bits.push(session.lastReason);
  if (session.claudeCalls) {
    bits.push(`${session.claudeCalls} Claude calls · ${session.claudeInTokens} in / ${session.claudeOutTokens} out`);
  }
  if (session.lastClaudeError) bits.push(`⚠ ${session.lastClaudeError}`);
  $("footer").textContent = bits.join(" — ");

  if (full) {
    $("goal").value = session.goal;
    tasks = session.tasks || [];
    renderTasks();
    renderSettings(settings);
  }
  renderAccount(auth);
}

function collectSettings() {
  const lines = (id) =>
    $(id).value.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    tone: $("tone").value,
    smartMode: $("smartMode").checked,
    keyMode: $("keyMode").checked ? "own" : "account",
    apiBase: $("apiBase").value.trim(),
    apiKey: $("apiKey").value.trim(),
    model: $("model").value,
    useScreenshots: $("useScreenshots").checked,
    focusSites: lines("focusSites"),
    distractSites: lines("distractSites")
  };
}

$("toggle").addEventListener("click", async () => {
  if (state.session.active) {
    await send({ type: "STOP_SESSION" });
  } else {
    await send({ type: "START_SESSION", goal: $("goal").value.trim(), tasks });
  }
  refresh(true);
});

$("taskInput").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !e.target.value.trim()) return;
  tasks.push({ text: e.target.value.trim(), done: false });
  e.target.value = "";
  send({ type: "SET_TASKS", tasks });
  renderTasks();
});

$("keyMode").addEventListener("change", () => {
  $("ownKeyBox").style.display = $("keyMode").checked ? "block" : "none";
});

// ---------------------------------------------------------------- account

$("sendCode").addEventListener("click", async () => {
  const email = $("email").value.trim();
  if (!email) return;
  $("authNote").textContent = "Sending…";
  await send({ type: "SAVE_SETTINGS", settings: collectSettings() });
  const out = await send({ type: "AUTH_REQUEST_CODE", email });
  if (out.ok) {
    $("codeBox").style.display = "block";
    $("authNote").textContent = `Code sent to ${email}. It expires in 10 minutes.`;
    $("code").focus();
  } else {
    $("authNote").textContent = `✗ ${out.error}`;
  }
});

$("verifyCode").addEventListener("click", async () => {
  const out = await send({
    type: "AUTH_VERIFY",
    email: $("email").value.trim(),
    code: $("code").value.trim()
  });
  if (out.ok) {
    $("authNote").textContent = "";
    $("codeBox").style.display = "none";
    $("code").value = "";
    refresh(true);
  } else {
    $("authNote").textContent = `✗ ${out.error}`;
  }
});

$("code").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("verifyCode").click();
});

$("signOut").addEventListener("click", async () => {
  await send({ type: "AUTH_SIGNOUT" });
  refresh(true);
});

$("upgrade").addEventListener("click", async () => {
  const out = await send({ type: "BILLING_CHECKOUT" });
  if (!out.ok) $("authNote").textContent = `✗ ${out.error}`;
});

$("save").addEventListener("click", async () => {
  await send({ type: "SAVE_SETTINGS", settings: collectSettings() });
  $("save").textContent = "Saved";
  setTimeout(() => ($("save").textContent = "Save settings"), 1200);
});

$("testKey").addEventListener("click", async () => {
  $("testResult").textContent = "Asking Claude…";
  const s = collectSettings();
  await send({ type: "SAVE_SETTINGS", settings: s });
  const out = await send({ type: "TEST_KEY", apiKey: s.apiKey, model: s.model });
  $("testResult").textContent = out.ok ? `✓ Working — "${out.message}"` : `✗ ${out.error}`;
});

// Editing the goal mid-session updates it without resetting the clocks.
$("goal").addEventListener("change", () => {
  if (state?.session.active) send({ type: "UPDATE_GOAL", goal: $("goal").value.trim() });
});

refresh(true);
// Pull the live plan and usage count; harmless if signed out.
send({ type: "AUTH_REFRESH" }).then(() => refresh());
setInterval(refresh, 1000);
