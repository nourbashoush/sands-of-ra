// Reads the council's answer: one JSON object, found even when the agent adds words or code fences
// around it. Never trusted: the powers go through validateActions (catalog.ts) against the live world.

import type { WorldSnapshot } from "../scenes/GameScene";
import { GODS, PRANKS, validateActions, type Decree, type GodName, type Prank } from "./catalog";

/** The first balanced {...} in the text that parses as JSON. */
function findJson(text: string): unknown {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return null;
}

export function readDecree(text: string, world: WorldSnapshot, granted: boolean): { decree: Decree; problems: string[] } {
  const problems: string[] = [];
  const raw = findJson(text) as Record<string, unknown> | null;
  if (!raw) problems.push("the council's answer was not readable JSON");
  const r = raw ?? {};
  const speaker = (typeof r.speaker === "string" && r.speaker.toLowerCase() in GODS ? r.speaker.toLowerCase() : "thoth") as GodName;
  const speech = typeof r.speech === "string" && r.speech.trim() ? r.speech.trim().slice(0, 280) : granted ? "It is done." : "No.";
  const { actions, dropped } = validateActions(r.actions, world, granted);
  problems.push(...dropped);
  const prank = !granted && typeof r.prank === "string" && (PRANKS as readonly string[]).includes(r.prank) ? (r.prank as Prank) : null;
  const agentMessage = typeof r.agent_message === "string" ? r.agent_message.trim().slice(0, 400) : "";
  const asides = (Array.isArray(r.asides) ? r.asides : [])
    .map((a) => (a ?? {}) as Record<string, unknown>)
    .filter((a) => typeof a.god === "string" && a.god.toLowerCase() in GODS && a.god.toLowerCase() !== speaker && typeof a.line === "string" && a.line.trim())
    .slice(0, 3)
    .map((a) => ({ god: (a.god as string).toLowerCase() as GodName, line: (a.line as string).trim().slice(0, 110) }));
  return { decree: { speaker, speech, actions, prank, agentMessage, asides }, problems };
}
