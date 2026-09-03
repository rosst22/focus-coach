// Free, offline classification: decide if the current tab looks like work or drift.
// This runs on every tick. The Claude call (lib/claude.js) is optional and only
// runs when this returns something ambiguous, so most ticks cost nothing.

export const DEFAULT_DISTRACTING = [
  "youtube.com", "tiktok.com", "instagram.com", "facebook.com", "x.com",
  "twitter.com", "reddit.com", "twitch.tv", "netflix.com", "hulu.com",
  "disneyplus.com", "9gag.com", "pinterest.com", "snapchat.com",
  "primevideo.com", "crunchyroll.com", "espn.com", "buzzfeed.com"
];

export const DEFAULT_PRODUCTIVE = [
  "github.com", "stackoverflow.com", "docs.google.com", "drive.google.com",
  "overleaf.com", "notion.so", "colab.research.google.com", "kaggle.com",
  "leetcode.com", "wikipedia.org", "arxiv.org", "scholar.google.com",
  "utoronto.ca", "q.utoronto.ca", "coursera.org", "khanacademy.org",
  "claude.ai", "chatgpt.com", "linkedin.com/jobs", "localhost"
];

// Pages that are not really "activity" — never counted for or against you.
const NEUTRAL_SCHEMES = ["chrome:", "chrome-extension:", "edge:", "about:", "devtools:"];

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function matches(url, host, list) {
  return list.some((entry) => {
    const e = entry.trim().toLowerCase().replace(/^www\./, "");
    if (!e) return false;
    // An entry may be a bare domain ("reddit.com") or include a path
    // ("linkedin.com/jobs"), so test the host first, then the whole URL.
    if (e.includes("/")) return url.toLowerCase().includes(e);
    return host === e || host.endsWith("." + e);
  });
}

// Words from the session goal, used to rescue a page that a blocklist would
// otherwise flag. Watching a lecture on YouTube for STAB22 is not drifting.
export function goalKeywords(goal) {
  const stop = new Set([
    "the", "and", "for", "with", "from", "this", "that", "your", "about",
    "work", "working", "study", "studying", "finish", "finishing", "some",
    "into", "onto", "then", "make", "made", "need", "want", "task", "tasks"
  ]);
  return (goal || "")
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length >= 4 && !stop.has(w));
}

/**
 * @returns {{verdict: "focus"|"drift"|"neutral", reason: string, confident: boolean}}
 * `confident` false means "ask Claude if smart mode is on".
 */
export function classify({ url, title, goal, focusSites, distractSites }) {
  if (!url || NEUTRAL_SCHEMES.some((s) => url.startsWith(s))) {
    return { verdict: "neutral", reason: "browser page", confident: true };
  }

  const host = hostOf(url);
  const hay = `${title || ""} ${url}`.toLowerCase();
  const keywords = goalKeywords(goal);
  const goalHit = keywords.filter((k) => hay.includes(k));

  if (matches(url, host, focusSites || [])) {
    return { verdict: "focus", reason: `${host} is on your focus list`, confident: true };
  }
  if (matches(url, host, distractSites || [])) {
    if (goalHit.length) {
      return {
        verdict: "focus",
        reason: `${host}, but the page mentions "${goalHit[0]}"`,
        confident: false
      };
    }
    return { verdict: "drift", reason: `${host} is on your distraction list`, confident: true };
  }
  if (matches(url, host, DEFAULT_PRODUCTIVE)) {
    return { verdict: "focus", reason: `${host} looks like work`, confident: true };
  }
  if (matches(url, host, DEFAULT_DISTRACTING)) {
    if (goalHit.length) {
      return {
        verdict: "focus",
        reason: `${host}, but the page mentions "${goalHit[0]}"`,
        confident: false
      };
    }
    return { verdict: "drift", reason: `${host} is usually a time sink`, confident: true };
  }
  if (goalHit.length) {
    return { verdict: "focus", reason: `page mentions "${goalHit[0]}"`, confident: false };
  }
  return { verdict: "neutral", reason: `${host} is unclassified`, confident: false };
}
