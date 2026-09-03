// Canned lines used when smart mode is off (or the API call fails).
// Three tones so the coach doesn't grate on you after a week.

const LINES = {
  hype: {
    streak: [
      "{m} minutes locked in. This is the good stuff.",
      "{m} straight minutes. You're actually doing it.",
      "{m} minutes deep and still going. Let's go.",
      "Certified {m}-minute focus run. Keep it rolling."
    ],
    recovery: [
      "Back already? That's the whole skill right there.",
      "Nice catch. Most people scroll for 20 more minutes.",
      "You caught yourself. That counts for a lot."
    ],
    task: [
      "DONE. {task} is off the list.",
      "{task} — finished. That's real progress.",
      "One down: {task}. Momentum is yours."
    ],
    nudge1: [
      "Hey — this isn't {goal}.",
      "Drifting. {goal} is still open.",
      "That's not the thing you sat down to do."
    ],
    nudge2: [
      "Still off track. {goal}, remember?",
      "Two minutes gone. Go finish {goal}.",
      "You told me the plan was {goal}. Let's honour it."
    ],
    nudge3: [
      "Stop. You said you'd do {goal}. Go do the next 10 minutes of it.",
      "Five minutes of this. Close the tab and open {goal}."
    ]
  },
  calm: {
    streak: [
      "{m} minutes of steady focus. Nicely done.",
      "That's {m} minutes without switching. Good rhythm.",
      "{m} minutes in. Keep the pace you've got."
    ],
    recovery: [
      "Welcome back. No harm done.",
      "Good — you noticed and came back.",
      "Back on track. That's the part that matters."
    ],
    task: [
      "{task} is done. Take a breath, then pick the next one.",
      "Finished: {task}. That's a real step forward.",
      "{task} complete. Good."
    ],
    nudge1: [
      "Gentle check: is this {goal}?",
      "This looks like a detour from {goal}.",
      "Just noting — you're off {goal}."
    ],
    nudge2: [
      "A couple of minutes off {goal} now. Worth heading back?",
      "Still away from {goal}. No judgement, just a nudge."
    ],
    nudge3: [
      "Five minutes off {goal}. Close this and take one small step on it.",
      "Time to come back to {goal}. One paragraph, one problem, one line."
    ]
  },
  coach: {
    streak: [
      "{m} minutes. Log it. Do another block.",
      "{m} minutes of work banked. Next rep.",
      "{m} minutes. That's the standard now."
    ],
    recovery: [
      "Good recovery. Now hold it longer this time.",
      "Back in. Reset the clock and go.",
      "That's how it's done. Next block starts now."
    ],
    task: [
      "{task}: cleared. What's next?",
      "{task} done. Don't celebrate long — next one.",
      "Rep complete: {task}."
    ],
    nudge1: [
      "Off task. {goal}.",
      "That's not the work. {goal}.",
      "Eyes up. {goal}."
    ],
    nudge2: [
      "Two minutes wasted. Get back to {goal}.",
      "You know this isn't {goal}. Fix it."
    ],
    nudge3: [
      "Five minutes gone. Close the tab. {goal}. Now.",
      "This is the moment the session is won or lost. Back to {goal}."
    ]
  }
};

export function pick(tone, kind, vars = {}) {
  const set = LINES[tone] || LINES.hype;
  const list = set[kind] || LINES.hype[kind] || [""];
  const line = list[Math.floor(Math.random() * list.length)];
  return line.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] === undefined ? "" : String(vars[key])
  );
}
