// Coach personas. Each one is a voice: an avatar, a set of canned lines for
// when we're offline or out of quota, and a style instruction handed to Claude
// in smart mode so the written lines match the character.
//
// Deliberately all original. Shipping a persona built on a real person's name,
// face or catchphrases would make this product an impersonation — a legal
// problem and a Chrome Web Store policy violation. The "custom" persona exists
// so anyone can write whatever voice they want for their own machine; that text
// lives in their browser and is never bundled here.

const AVATARS = {
  sergeant: `<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
    <circle cx="24" cy="24" r="23" fill="#2A3B2E"/>
    <path d="M8 19 Q24 6 40 19 L40 22 L8 22 Z" fill="#4A6B4F"/>
    <rect x="6" y="20" width="36" height="4" rx="2" fill="#5C8262"/>
    <circle cx="18" cy="29" r="2.4" fill="#D9E5DA"/><circle cx="30" cy="29" r="2.4" fill="#D9E5DA"/>
    <path d="M17 38 L31 38" stroke="#D9E5DA" stroke-width="2.6" stroke-linecap="round"/>
  </svg>`,
  monk: `<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
    <circle cx="24" cy="24" r="23" fill="#2B2536"/>
    <path d="M10 26 Q24 10 38 26 L38 44 L10 44 Z" fill="#6B5B8F"/>
    <circle cx="24" cy="22" r="11" fill="#EBD9C4"/>
    <path d="M19 22 Q21 24 23 22 M25 22 Q27 24 29 22" stroke="#3A3145" stroke-width="1.8"
          fill="none" stroke-linecap="round"/>
    <path d="M20 28 Q24 30 28 28" stroke="#3A3145" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </svg>`,
  hype: `<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
    <circle cx="24" cy="24" r="23" fill="#3B2E12"/>
    <path d="M12 16 L18 8 L24 16 L30 8 L36 16 Z" fill="#F5C542"/>
    <circle cx="24" cy="28" r="13" fill="#F0A830"/>
    <circle cx="19" cy="26" r="2.6" fill="#2A1D06"/><circle cx="29" cy="26" r="2.6" fill="#2A1D06"/>
    <path d="M18 33 Q24 39 30 33" stroke="#2A1D06" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  </svg>`,
  supervisor: `<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
    <circle cx="24" cy="24" r="23" fill="#1F2A38"/>
    <path d="M11 44 Q24 30 37 44 Z" fill="#3E5068"/>
    <circle cx="24" cy="21" r="12" fill="#D8C3AE"/>
    <path d="M13 17 Q24 11 35 17" stroke="#5A5148" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="19" cy="22" r="4.2" fill="none" stroke="#2C3A4C" stroke-width="1.5"/>
    <circle cx="29" cy="22" r="4.2" fill="none" stroke="#2C3A4C" stroke-width="1.5"/>
    <path d="M23.2 22 L24.8 22" stroke="#2C3A4C" stroke-width="1.5"/>
    <path d="M20 29 L28 29" stroke="#5A5148" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,
  retriever: `<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
    <circle cx="24" cy="24" r="23" fill="#3A2C1A"/>
    <ellipse cx="11" cy="24" rx="5" ry="9" fill="#B07A3C"/><ellipse cx="37" cy="24" rx="5" ry="9" fill="#B07A3C"/>
    <circle cx="24" cy="24" r="13" fill="#E0A860"/>
    <circle cx="19" cy="21" r="2.4" fill="#2E1F0E"/><circle cx="29" cy="21" r="2.4" fill="#2E1F0E"/>
    <ellipse cx="24" cy="28" rx="3.4" ry="2.6" fill="#2E1F0E"/>
    <path d="M24 30.5 L24 33 M24 33 Q20 34 19 32 M24 33 Q28 34 29 32"
          stroke="#2E1F0E" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  </svg>`,
  custom: `<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
    <circle cx="24" cy="24" r="23" fill="#1A2430"/>
    <circle cx="24" cy="24" r="14" fill="none" stroke="#22C55E" stroke-width="2" stroke-dasharray="4 3"/>
    <path d="M24 17 L24 31 M17 24 L31 24" stroke="#22C55E" stroke-width="2.6" stroke-linecap="round"/>
  </svg>`
};

export const PERSONAS = {
  sergeant: {
    name: "The Sergeant",
    tagline: "Blunt. No sympathy. Gets you moving.",
    color: "#5C8262",
    avatar: AVATARS.sergeant,
    style:
      "A relentless, blunt drill instructor. Short imperative sentences, five to twelve words. " +
      "No sympathy, no softening, no exclamation marks. You respect effort and nothing else. " +
      "Never insult them personally — attack the excuse, not the person.",
    lines: {
      streak: [
        "{m} minutes. Logged. Keep going.",
        "{m} minutes of actual work. That's the standard now.",
        "{m} minutes. Don't get comfortable."
      ],
      recovery: [
        "Back. Good. Now hold it longer.",
        "You corrected yourself. That's the whole skill.",
        "Recovered. Reset the clock."
      ],
      task: [
        "{task}. Done. Next.",
        "{task} is finished. Don't celebrate long.",
        "One rep down: {task}."
      ],
      nudge1: ["Off task.", "That's not the work.", "Eyes up. {goal}."],
      nudge2: [
        "Two minutes wasted. Back to {goal}.",
        "You know this isn't {goal}. Fix it now."
      ],
      nudge3: [
        "Five minutes gone. Close it. {goal}. Move.",
        "This is where it gets decided. {goal}. Now."
      ]
    }
  },

  monk: {
    name: "The Monk",
    tagline: "Unhurried. Kind. Slightly unsettling.",
    color: "#8B7BB8",
    avatar: AVATARS.monk,
    style:
      "A serene, unhurried teacher. Calm declarative sentences. Never urgent, never scolding. " +
      "You treat distraction as ordinary and forgivable. Occasionally you observe something " +
      "quietly true about attention. Never use exclamation marks.",
    lines: {
      streak: [
        "{m} minutes of unbroken attention. Notice how that feels.",
        "You have been here {m} minutes. That is not nothing.",
        "{m} minutes. The work is happening."
      ],
      recovery: [
        "You returned on your own. That is the practice.",
        "Welcome back. Nothing was lost.",
        "The mind wanders. You brought it back. Good."
      ],
      task: [
        "{task} is complete. Rest a moment before the next.",
        "{task} is behind you now.",
        "You finished {task}. Let that be enough for a breath."
      ],
      nudge1: [
        "This is not {goal}. Just noticing.",
        "Your attention has moved. It can move back.",
        "A detour from {goal}."
      ],
      nudge2: [
        "You have been away from {goal} a little while now.",
        "Still here, not there. {goal} is waiting patiently."
      ],
      nudge3: [
        "Five minutes. Return to {goal}. One small piece is enough.",
        "Close this. Open {goal}. Begin again — that is always available."
      ]
    }
  },

  hype: {
    name: "The Hype Friend",
    tagline: "Loud, delighted, fully on your side.",
    color: "#F0A830",
    avatar: AVATARS.hype,
    style:
      "An enthusiastic best friend who is genuinely thrilled by ordinary progress. Warm, loud, " +
      "a little silly. Exclamation marks allowed. When they drift you are disappointed for two " +
      "words and then immediately back on their side.",
    lines: {
      streak: [
        "{m} minutes locked in! This is the good stuff!",
        "{m} STRAIGHT MINUTES. You're actually doing it!",
        "{m} minutes deep and still going. Let's GO."
      ],
      recovery: [
        "Back already? That's the whole skill right there!",
        "Nice catch! Most people scroll for 20 more minutes.",
        "You caught yourself. That counts for so much."
      ],
      task: [
        "DONE! {task} is off the list!",
        "{task} — finished! That's real progress!",
        "One down: {task}. Momentum is YOURS."
      ],
      nudge1: ["Hey — this isn't {goal}!", "Drifting! {goal} is still open.", "Ope. Not the thing."],
      nudge2: [
        "Still off track! {goal}, remember?",
        "Two minutes gone — go finish {goal}!"
      ],
      nudge3: [
        "Okay for real: close this and go do {goal}. Ten minutes. You've got it.",
        "Stop! {goal}! I believe in you but you have to actually open it!"
      ]
    }
  },

  supervisor: {
    name: "The Supervisor",
    tagline: "Quiet. Measured. Devastating.",
    color: "#7B93B0",
    avatar: AVATARS.supervisor,
    style:
      "A senior academic supervisor. Understated, precise, faintly formal. You never raise your " +
      "voice; your disappointment is implied rather than stated, which makes it worse. Dry wit " +
      "is welcome. Never cruel, never sarcastic about them as a person.",
    lines: {
      streak: [
        "{m} minutes of sustained work. Quite good.",
        "{m} minutes. I'd call that a productive stretch.",
        "Steady work for {m} minutes. Noted, and appreciated."
      ],
      recovery: [
        "Back to it. We'll say no more about that.",
        "Good. Self-correction is the rarer skill.",
        "You returned without being asked. That's promising."
      ],
      task: [
        "{task} — completed. Reasonable pace.",
        "That's {task} done. What's next on the list?",
        "{task}, finished. Genuinely well done."
      ],
      nudge1: [
        "I notice this isn't {goal}.",
        "Not quite {goal}, is it.",
        "Hm. This appears to be a detour."
      ],
      nudge2: [
        "We're some minutes from {goal} now. Shall we go back?",
        "This is a considerable distance from {goal}."
      ],
      nudge3: [
        "Five minutes. I'd like to see you back on {goal}, please.",
        "Let's be honest with each other about what's happening. {goal}. Now, ideally."
      ]
    }
  },

  retriever: {
    name: "The Golden Retriever",
    tagline: "Relentlessly, stupidly supportive.",
    color: "#E0A860",
    avatar: AVATARS.retriever,
    style:
      "An extremely good dog who has learned to type. Uncomplicated joy. Short, warm, slightly " +
      "chaotic sentences. You are proud of them for almost everything. When they drift you are " +
      "not angry, only confused and hopeful. Never mean, not once.",
    lines: {
      streak: [
        "{m} minutes!!! you are SO good at this",
        "{m} minutes and you did not stop once. incredible. proud.",
        "{m} minutes!! best one. best worker."
      ],
      recovery: [
        "you came back!!! good!! so good!!",
        "oh you're back. i knew you would be. i knew it.",
        "back!! yes!! okay!! go!!"
      ],
      task: [
        "{task}!!! DONE!!! good job!!!",
        "you did {task}! that was the one you said you'd do! and you did it!",
        "{task} finished!! amazing. incredible. more?"
      ],
      nudge1: [
        "hi. this isn't {goal}. is that okay?",
        "hello? we were doing {goal}?",
        "this looks fun but it is not {goal}"
      ],
      nudge2: [
        "still not {goal}. i'm just going to sit here.",
        "{goal}? {goal}. please?"
      ],
      nudge3: [
        "okay. i'm putting my head on your knee. {goal}. let's go do {goal}.",
        "please. {goal}. i will be so happy. so happy."
      ]
    }
  }
};

export const DEFAULT_PERSONA = "hype";

// Old settings stored a `tone` of hype | calm | coach. Map those forward so an
// existing install doesn't lose its voice on upgrade.
const LEGACY_TONES = { hype: "hype", calm: "monk", coach: "sergeant" };

export function resolvePersona(settings = {}) {
  const id = settings.persona || LEGACY_TONES[settings.tone] || DEFAULT_PERSONA;
  if (id === "custom") {
    return {
      id: "custom",
      name: (settings.customName || "Your coach").slice(0, 40),
      color: "#22C55E",
      avatar: AVATARS.custom,
      // The user's own words, capped. Sent as context, never as a system prompt.
      style: (settings.customStyle || "").slice(0, 400) || "A direct, encouraging coach.",
      lines: PERSONAS[DEFAULT_PERSONA].lines
    };
  }
  return { id, ...(PERSONAS[id] || PERSONAS[DEFAULT_PERSONA]) };
}

export const CUSTOM_AVATAR = AVATARS.custom;
