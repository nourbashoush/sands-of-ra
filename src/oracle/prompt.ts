// Builds the prompt for the oracle (a coding agent called headless, see server/oracle.ts).
// The agent is a pure function: everything it knows is in this text, and all it can do is answer.

import { gridToText, TERRAIN_CODES, UNIT_CODES, WIDTH, type Level } from "../levelFormat";

export type Layer = "both" | "terrain" | "units";
export type HistoryItem = { request: string; outcome: string };
export type PromptInput = {
  level: Level;
  rows: [number, number];
  layer: Layer;
  request: string;
  history: HistoryItem[];
  rulesOn: boolean;
  problems?: string[]; // set on the automatic retry
};

/** What each code means in play, for the agent (the labels are in levelFormat.ts). */
const UNIT_NOTES: Record<string, string> = {
  s1: "walks toward the player and fires cursed bolts",
  s2: "keeps its distance and lobs curses in an arc",
  t1: "a 2x2 stone sphinx that rolls along the road; its head spits cat bombs. Write t1 in the top-left cell, the other three cells stay ..",
  b1: "a fixed guardian sphinx turret; it blocks the way like a wall",
  h1: "a prisoner to rescue (points)",
  g1: "a sandstorm bomb pickup",
  c1: "a cat that joins the player's army when touched",
  k1: "the Pharaoh's chariot boss; at most one in the whole level, at the temple end",
};
const TERRAIN_NOTES: Record<string, string> = {
  "..": "walkable", rd: "walkable", "==": "walkable (crosses water)", pv: "walkable", ff: "walkable", rs: "walkable",
  "##": "blocks, stops bullets and sight", "~~": "blocks (cannot be walked on)", sb: "blocks", tr: "blocks", bx: "blocks, explodes when shot",
  cr: "blocks, can be shot apart", py: "blocks a 3x3 area; write py in the top-left cell, the other eight cells stay ..",
  ob: "blocks", co: "blocks", an: "blocks", bt: "blocks",
};

// The fixed part, built once.
const STATIC = `You are Thoth, the ibis-headed scribe of the Egyptian gods, and you redraw a level of a game when a player makes a wish.

THE GAME
A top-down run-and-gun in ancient Egypt. The pharaoh starts at the bottom of the map and fights north to the temple at the top (row 000),
past mummies, sphinxes and the Nile. The map is 16 columns wide; every cell is a two-character code.

THE MAP FORMAT
Two grids of the same size: TERRAIN (the ground) and UNITS (who stands there). Every line starts with its 3-digit row number,
then 16 cells separated by single spaces. Every cell is exactly two characters. ".." means empty.

TERRAIN CODES
${Object.entries(TERRAIN_CODES).map(([k, v]) => `${k}  ${v.label}: ${TERRAIN_NOTES[k] ?? ""}`).join("\n")}

UNIT CODES
${Object.entries(UNIT_CODES).filter(([k]) => k !== "..").map(([k, v]) => `${k}  ${v.label}: ${UNIT_NOTES[k] ?? ""}`).join("\n")}`;

const RULES = `RULES THE RESULT MUST OBEY
- Use only the codes listed above. Never invent a code.
- There must stay a way on foot from the bottom row to the top row. Walkable: .. rd == pv ff rs. Everything else blocks,
  and so do pyramids (3x3), sphinx tanks (2x2) and guardian sphinxes.
- Units stand on walkable ground. A sphinx tank's four cells must all be road (rd or ==).
- No enemy within 4 tiles of the player's start (second-to-last row, columns 7 and 8).
- Prisoners, pickups and cats must be reachable on foot.
- A pyramid or tank's covered cells stay "..".`;

export function buildPrompt(p: PromptInput): string {
  const [from, to] = p.rows;
  const rowsLabel = from === to ? `row ${pad(from)}` : `rows ${pad(from)} to ${pad(to)}`;
  const grids = p.layer === "both" ? "TERRAIN and UNITS" : p.layer === "terrain" ? "TERRAIN only (leave UNITS alone)" : "UNITS only (leave TERRAIN alone)";
  const blocks = (p.layer === "units" ? [] : ["terrain"]).concat(p.layer === "terrain" ? [] : ["units"]);
  const example = blocks.map((b) => `\`\`\`${b}\n${pad(from)} ${Array(WIDTH).fill("..").join(" ")}\n...one line for every row from ${pad(from)} to ${pad(to)}\n\`\`\``).join("\n");
  const history = p.history.length
    ? `\nEARLIER WISHES (oldest first)\n${p.history.slice(-5).map((h) => `- "${h.request}": ${h.outcome}`).join("\n")}\n`
    : "";
  const retry = p.problems?.length
    ? `\nYOUR LAST ANSWER WAS REJECTED. Fix these problems and answer again:\n${p.problems.map((x) => `- ${x}`).join("\n")}\n`
    : "";
  return `${STATIC}

${p.rulesOn ? RULES : ""}

THE WHOLE LEVEL (for context)
TERRAIN
${gridToText(p.level.terrain)}

UNITS
${gridToText(p.level.units)}
${history}
WHAT YOU MAY CHANGE
${rowsLabel} of ${grids}. Every other row stays exactly as it is.
${retry}
THE WISH
"${p.request}"

HOW TO ANSWER (exactly this, nothing else)
ORACLE: <one short line, in character as Thoth, telling the player what you carved>
AGENT_MESSAGE: <only if something concerns you: the wish needs something the game cannot do, it is unclear, or you had to change more than asked>
${example}

Give the complete rows from ${pad(from)} to ${pad(to)}, each with its row number, even the ones you did not change.
If the wish cannot be done with these codes at all, answer with only the ORACLE line (a polite refusal in character) and an AGENT_MESSAGE line.`;
}

const pad = (n: number) => String(n).padStart(3, "0");
