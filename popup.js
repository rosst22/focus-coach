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
  $("apiKey").value = s.apiKey;
  $("model").value = s.model;
  $("useScreenshots").checked = s.useScreenshots;
  $("focusSites").value = (s.focusSites || []).join("\n");
  $("distractSites").value = (s.distractSites || []).join("\n");
  $("smartBox").style.display = s.smartMode ? "block" : "none";
}

async function refresh(full = false) {
  state = await send({ type: "GET_STATE" });
  const { session, settings, streakMs } = state;

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
}

function collectSettings() {
  const lines = (id) =>
    $(id).value.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    tone: $("tone").value,
    smartMode: $("smartMode").checked,
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

$("smartMode").addEventListener("change", () => {
  $("smartBox").style.display = $("smartMode").checked ? "block" : "none";
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
setInterval(refresh, 1000);
