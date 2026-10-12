// Reads the oracle's answer. Never trusted: it is parsed strictly, then checked (src/rules.ts),
// and only applied by the player. Chatter around the answer is tolerated.

import { TERRAIN_CODES, UNIT_CODES, WIDTH, type Grid, type Level } from "../levelFormat";
import type { Layer } from "./prompt";

export type Reply = {
  voice: string; // the ORACLE line
  messages: string[]; // AGENT_MESSAGE lines
  terrain?: Map<number, string[]>;
  units?: Map<number, string[]>;
  refused: boolean; // no rows at all: the oracle declined
};
export type Parsed = { ok: true; reply: Reply } | { ok: false; errors: string[]; reply: Reply };

const ROW = /^\s*(\d{3})\s+(.+?)\s*$/;
const FENCE = /^\s*```\s*(terrain|units|ground)?/i;

/** Splits the text into labelled blocks of row lines. Tolerates missing labels and missing fences. */
function blocks(text: string) {
  type Block = { layer?: "terrain" | "units"; lines: string[]; fenced: boolean };
  const out: Block[] = [];
  let cur: Block | null = null;
  let lastLabel: "terrain" | "units" | undefined;
  for (const line of text.split("\n")) {
    const fence = FENCE.exec(line);
    if (fence) {
      if (cur?.fenced) { cur = null; continue; } // closing fence
      const label = fence[1]?.toLowerCase();
      cur = { layer: label === "units" ? "units" : label ? "terrain" : lastLabel, lines: [], fenced: true };
      lastLabel = undefined;
      out.push(cur);
      continue;
    }
    const heading = /^\s*[#*]*\s*(terrain|units|ground)\b/i.exec(line);
    if (heading && !cur?.fenced) {
      lastLabel = heading[1].toLowerCase() === "units" ? "units" : "terrain";
      cur = null; // a loose run of rows ends at a heading
      continue;
    }
    if (ROW.test(line)) {
      if (!cur) { cur = { layer: lastLabel, lines: [], fenced: false }; lastLabel = undefined; out.push(cur); }
      cur.lines.push(line);
    }
  }
  return out;
}

export function parseReply(text: string, rows: [number, number], layer: Layer): Parsed {
  const errors: string[] = [];
  const voice = /^\s*\**ORACLE\**\s*:\s*(.+)$/im.exec(text)?.[1].trim() ?? "";
  const messages = [...text.matchAll(/^\s*\**AGENT_MESSAGE\**\s*:\s*(.+)$/gim)].map((m) => m[1].trim());
  const reply: Reply = { voice, messages, refused: false };
  const found = blocks(text).filter((b) => b.lines.length);
  if (!found.length) {
    reply.refused = true;
    return voice || messages.length ? { ok: true, reply } : { ok: false, errors: ["the answer had no rows and no ORACLE line"], reply };
  }

  const wanted = layer === "both" ? ["terrain", "units"] : [layer];
  // unlabelled blocks are given out in order
  found.forEach((b, i) => { b.layer ??= wanted[i] as "terrain" | "units"; });
  const expect = rows[1] - rows[0] + 1;
  for (const name of wanted as ("terrain" | "units")[]) {
    const b = found.find((x) => x.layer === name);
    if (!b) { errors.push(`the ${name} rows are missing`); continue; }
    const codes = name === "terrain" ? TERRAIN_CODES : UNIT_CODES;
    const grid = new Map<number, string[]>();
    for (const line of b.lines) {
      const [, num, rest] = ROW.exec(line)!;
      const r = Number(num), cells = rest.split(/\s+/);
      if (r < rows[0] || r > rows[1]) { errors.push(`${name} row ${num} is outside the rows it may change`); continue; }
      if (grid.has(r)) { errors.push(`${name} row ${num} appears twice`); continue; }
      if (cells.length !== WIDTH) errors.push(`${name} row ${num} has ${cells.length} cells, not ${WIDTH}`);
      cells.forEach((cell, c) => {
        if (cell.length !== 2) errors.push(`${name} row ${num} col ${c}: "${cell}" is not two characters`);
        else if (!(cell in codes)) errors.push(`${name} row ${num} col ${c}: unknown code "${cell}"`);
      });
      grid.set(r, cells);
    }
    if (grid.size !== expect) {
      const missing = [];
      for (let r = rows[0]; r <= rows[1]; r++) if (!grid.has(r)) missing.push(String(r).padStart(3, "0"));
      if (missing.length) errors.push(`${name}: missing row ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`);
    }
    reply[name] = grid;
  }
  if (layer !== "both") {
    const other = layer === "terrain" ? "units" : "terrain";
    if (found.some((b) => b.layer === other)) errors.push(`it changed ${other}, which was not allowed this time`);
  }
  return errors.length ? { ok: false, errors: errors.slice(0, 8), reply } : { ok: true, reply };
}

/** The proposed level: the current one with the oracle's rows put in. */
export function applyReply(level: Level, reply: Reply): Level {
  const put = (grid: Grid, rows?: Map<number, string[]>) => grid.map((row, r) => (rows?.has(r) ? [...rows.get(r)!] : [...row]));
  return { ...level, terrain: put(level.terrain, reply.terrain), units: put(level.units, reply.units) };
}

/** Rows that are complete so far in a reply still being written (for the live preview). */
export function partialRows(text: string, rows: [number, number], layer: Layer) {
  const wanted = layer === "both" ? ["terrain", "units"] : [layer];
  const out: { layer: "terrain" | "units"; r: number; cells: string[] }[] = [];
  blocks(text).forEach((b, i) => {
    const name = (b.layer ?? wanted[i]) as "terrain" | "units" | undefined;
    if (!name || !wanted.includes(name)) return;
    const codes = name === "terrain" ? TERRAIN_CODES : UNIT_CODES;
    for (const line of b.lines) {
      const [, num, rest] = ROW.exec(line)!;
      const r = Number(num), cells = rest.split(/\s+/);
      if (r >= rows[0] && r <= rows[1] && cells.length === WIDTH && cells.every((c) => c in codes)) out.push({ layer: name, r, cells });
    }
  });
  return out;
}

/** What changed, counted for the proposal card ("+2 mummy", "−5 sandstone wall"). */
export function summarize(before: Level, after: Level) {
  const counts = new Map<string, number>();
  const bump = (code: string, d: number) => code !== ".." && counts.set(code, (counts.get(code) ?? 0) + d);
  for (const g of ["terrain", "units"] as const) {
    before[g].forEach((row, r) => row.forEach((code, c) => {
      const next = after[g][r][c];
      if (next === code) return;
      bump(code, -1);
      bump(next, +1);
    }));
  }
  const label = (code: string) => (TERRAIN_CODES[code] ?? UNIT_CODES[code])?.label.replace(/,.*$/, "").replace(/ \(.*\)$/, "") ?? code;
  return [...counts].filter(([, n]) => n).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([code, n]) => ({ code, n, label: label(code) }));
}
