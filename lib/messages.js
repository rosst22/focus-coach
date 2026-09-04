// Picks a canned line for the active persona. Used when smart mode is off, when
// the daily quota is spent, or when an API call fails — the coach always has
// something to say. The lines themselves live with their persona in personas.js.

import { resolvePersona } from "./personas.js";

export function pick(settings, kind, vars = {}) {
  const persona = resolvePersona(settings);
  const list = persona.lines[kind] || [""];
  const line = list[Math.floor(Math.random() * list.length)];
  return line.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] === undefined ? "" : String(vars[key])
  );
}
