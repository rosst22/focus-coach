// Optional "smart mode": ask Claude to judge the page and write the line.
//
// Why raw fetch instead of the Anthropic SDK: this extension has no build step,
// and an MV3 service worker can call the API directly because manifest.json
// grants host access to api.anthropic.com. Requests from an extension origin
// need the dangerous-direct-browser-access header.

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

// `effort` is not accepted by Haiku 4.5, so only send it on models that take it.
const SUPPORTS_EFFORT = /^claude-(opus|sonnet|fable)-/;
// Server-side refusal fallbacks: on a policy decline the API silently retries on
// another model inside the same call instead of returning nothing.
const SUPPORTS_FALLBACK = /^claude-(opus-5|fable-)/;

const SYSTEM = `You are a focus coach living in someone's browser. You get their stated goal, their open task list, and what is on screen right now. You decide whether the screen serves the goal.

Rules:
- "focus" = the screen plausibly serves the goal, even indirectly (docs, a lecture video, a reference, a tool they need).
- "drift" = entertainment, feeds, or unrelated browsing.
- "neutral" = you genuinely cannot tell, or it is a blank/settings/new tab page.
- Be generous about research. Be strict about infinite feeds.
- Write one line, under 140 characters, speaking directly to them, in the requested tone.
- For "focus", the line should be specific encouragement about what they are actually doing. Never generic praise.
- For "drift", name the goal and tell them to go back. No shaming, no lectures.
- Set "celebrate" true only when the screen shows something finished or submitted (a merged PR, a submitted assignment, a passing test run, a sent email).

Reply with ONLY a JSON object: {"verdict":"focus"|"drift"|"neutral","message":"...","celebrate":true|false}`;

function buildUserContent({ goal, tasks, url, title, pageText, screenshot }) {
  const content = [];
  if (screenshot) {
    const [, mediaType, data] = screenshot.match(/^data:(image\/\w+);base64,(.+)$/) || [];
    if (data) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data }
      });
    }
  }
  const open = (tasks || []).filter((t) => !t.done).map((t) => `- ${t.text}`).join("\n");
  content.push({
    type: "text",
    text: [
      `Goal for this session: ${goal || "(not stated)"}`,
      open ? `Open tasks:\n${open}` : "Open tasks: (none listed)",
      `Tab title: ${title || "(none)"}`,
      `URL: ${url}`,
      pageText ? `Visible text (truncated):\n${pageText.slice(0, 1200)}` : ""
    ]
      .filter(Boolean)
      .join("\n\n")
  });
  return content;
}

function extractJson(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON in response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * @returns {Promise<{verdict:string, message:string, celebrate:boolean}>}
 * Throws on any API or parse failure — the caller falls back to heuristics.
 */
export async function askClaude({ apiKey, model, tone, ...ctx }) {
  const headers = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": API_VERSION,
    "anthropic-dangerous-direct-browser-access": "true"
  };

  const body = {
    model,
    max_tokens: 400,
    system: `${SYSTEM}\n\nTone to write in: ${tone}.`,
    messages: [{ role: "user", content: buildUserContent(ctx) }]
  };

  if (SUPPORTS_EFFORT.test(model)) {
    // Low effort: this is a snap judgement, not a research task. Keeps it fast and cheap.
    body.output_config = { effort: "low" };
  }
  if (SUPPORTS_FALLBACK.test(model)) {
    headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
    body.fallbacks = "default";
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Claude API ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  if (data.stop_reason === "refusal") throw new Error("request declined by safety classifier");

  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = extractJson(text);

  return {
    verdict: ["focus", "drift", "neutral"].includes(parsed.verdict) ? parsed.verdict : "neutral",
    message: String(parsed.message || "").slice(0, 200),
    celebrate: Boolean(parsed.celebrate),
    usage: data.usage || null
  };
}
