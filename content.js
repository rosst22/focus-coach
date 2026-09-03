// Focus Coach — on-page UI.
//
// Everything lives inside a shadow root so no page's CSS can break the coach,
// and the coach's CSS can't break the page. Injected on every page, but it
// draws nothing until the background worker sends it something.

(() => {
  if (window.__focusCoachLoaded) return; // executeScript fallback can double-inject
  window.__focusCoachLoaded = true;

  const HOST_ID = "focus-coach-root";
  let host = null;
  let root = null;
  let hideTimer = null;

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont,
        "Segoe UI", system-ui, sans-serif; }

    .toast {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      max-width: 330px; padding: 14px 16px; border-radius: 14px;
      background: #10151c; color: #e8edf3; font-size: 14px; line-height: 1.45;
      box-shadow: 0 12px 32px rgba(0,0,0,.38); border: 1px solid #22C55E;
      display: flex; gap: 11px; align-items: flex-start;
      animation: slide .28s cubic-bezier(.2,.9,.3,1.2);
    }
    .toast.nudge  { border-color: #F59E0B; }
    .toast.nudge2 { border-color: #EF4444; }
    .emoji { font-size: 20px; line-height: 1.2; }
    .body { flex: 1; }
    .why { margin-top: 5px; font-size: 11px; color: #7c8a99; }
    .x {
      cursor: pointer; color: #55606d; font-size: 16px; line-height: 1;
      background: none; border: 0; padding: 2px 4px;
    }
    .x:hover { color: #e8edf3; }

    .scrim {
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(6,9,13,.82); backdrop-filter: blur(3px);
      display: flex; align-items: center; justify-content: center;
      animation: fade .25s ease;
    }
    .card {
      width: min(460px, 88vw); padding: 30px; border-radius: 20px;
      background: #10151c; color: #e8edf3; text-align: center;
      border: 1px solid #EF4444; box-shadow: 0 24px 70px rgba(0,0,0,.55);
    }
    .card h1 { margin: 0 0 10px; font-size: 21px; font-weight: 650; }
    .goal {
      margin: 16px 0 22px; padding: 13px; border-radius: 12px;
      background: #172030; font-size: 15px; color: #9fe6bb;
    }
    .row { display: flex; gap: 10px; justify-content: center; }
    button.act {
      cursor: pointer; border: 0; border-radius: 10px; padding: 11px 17px;
      font-size: 14px; font-weight: 600;
    }
    .primary { background: #22C55E; color: #06120a; }
    .ghost { background: #1d2733; color: #9aa7b4; }

    canvas.confetti { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; }

    @keyframes slide { from { transform: translateY(14px); opacity: 0 } to { transform: none; opacity: 1 } }
    @keyframes fade  { from { opacity: 0 } to { opacity: 1 } }
  `;

  function mount() {
    if (host && document.documentElement.contains(host)) return root;
    host = document.createElement("div");
    host.id = HOST_ID;
    root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    root.appendChild(style);
    (document.body || document.documentElement).appendChild(host);
    return root;
  }

  function clear() {
    if (!root) return;
    root.querySelectorAll(".toast, .scrim").forEach((n) => n.remove());
    clearTimeout(hideTimer);
  }

  function toast({ mood, text, reason, level }) {
    const shadow = mount();
    clear();
    const el = document.createElement("div");
    el.className = `toast ${mood === "nudge" ? (level >= 2 ? "nudge nudge2" : "nudge") : ""}`;
    const emoji = mood === "celebrate" ? "🎉" : mood === "nudge" ? "👀" : "💪";
    el.innerHTML = `
      <div class="emoji"></div>
      <div class="body"><div class="text"></div><div class="why"></div></div>
      <button class="x" title="dismiss">×</button>`;
    el.querySelector(".emoji").textContent = emoji;
    el.querySelector(".text").textContent = text;
    el.querySelector(".why").textContent = reason || "";
    el.querySelector(".x").addEventListener("click", clear);
    shadow.appendChild(el);
    hideTimer = setTimeout(clear, mood === "nudge" ? 12000 : 7000);
    if (mood === "celebrate") confetti();
  }

  function overlay({ text, goal }) {
    const shadow = mount();
    clear();
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.innerHTML = `
      <div class="card">
        <h1></h1>
        <div class="goal"></div>
        <div class="row">
          <button class="act primary">Okay, back to it</button>
          <button class="act ghost">5 more minutes</button>
        </div>
      </div>`;
    scrim.querySelector("h1").textContent = text;
    scrim.querySelector(".goal").textContent = goal ? `Your goal: ${goal}` : "You set out to do real work.";
    scrim.querySelector(".primary").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "ACK_NUDGE" });
      clear();
    });
    scrim.querySelector(".ghost").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "SNOOZE", minutes: 5 });
      clear();
    });
    shadow.appendChild(scrim);
  }

  // Small canvas burst — cheap, no library, removes itself when the pieces land.
  function confetti() {
    const shadow = mount();
    const canvas = document.createElement("canvas");
    canvas.className = "confetti";
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    shadow.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const colors = ["#22C55E", "#4ADE80", "#FDE047", "#60A5FA", "#F472B6"];
    const bits = Array.from({ length: 90 }, () => ({
      x: canvas.width / 2 + (Math.random() - 0.5) * 260,
      y: canvas.height * 0.35 + Math.random() * 40,
      vx: (Math.random() - 0.5) * 9,
      vy: Math.random() * -11 - 3,
      size: 5 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)]
    }));

    let frame = 0;
    (function step() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      bits.forEach((b) => {
        b.vy += 0.32;           // gravity
        b.x += b.vx;
        b.y += b.vy;
        b.rot += b.spin;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.size / 2, -b.size / 2, b.size, b.size * 0.6);
        ctx.restore();
      });
      frame += 1;
      if (frame < 150) requestAnimationFrame(step);
      else canvas.remove();
    })();
  }

  // Readable text for the smart-mode prompt: headings and paragraphs, not scripts.
  function visibleText() {
    const parts = [];
    document
      .querySelectorAll("h1, h2, h3, p, li, article, [role='heading']")
      .forEach((node) => {
        if (parts.join(" ").length > 2000) return;
        const t = (node.innerText || "").trim();
        if (t && t.length < 400) parts.push(t);
      });
    return parts.join(" · ").slice(0, 2000);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "COACH_SHOW") {
      if (msg.mood === "nudge" && msg.level >= 3) overlay(msg);
      else toast(msg);
      sendResponse({ ok: true });
    } else if (msg.type === "COACH_CLEAR") {
      clear();
      sendResponse({ ok: true });
    } else if (msg.type === "COACH_GET_CONTEXT") {
      sendResponse({ title: document.title, text: visibleText() });
    }
    return true;
  });
})();
