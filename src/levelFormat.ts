// The level file format, shared by the game, the dev server (load and save) and the editor.
// One level = one TOML file in data/levels/. Two grids of equal size, 16 columns x N rows,
// every cell exactly two characters, each line prefixed by its 3-digit row number, row 000 at the top.
// No Phaser here: vite.config.ts imports this too.

export type Grid = string[][];
export type Level = { name: string; width: number; height: number; terrain: Grid; units: Grid };
export type Checked = { ok: true; level: Level } | { ok: false; errors: string[] };

export const WIDTH = 16;

/** Every code the game understands: label (for legends and the editor palette) and an editor swatch. */
export const TERRAIN_CODES: Record<string, { label: string; color: string }> = {
  "..": { label: "sand", color: "#e2c48a" },
  rd: { label: "road (paved)", color: "#b9a27a" },
  pv: { label: "temple paving", color: "#d6c4a0" },
  ff: { label: "fertile bank", color: "#7aa04a" },
  rs: { label: "papyrus reeds", color: "#4f7a32" },
  "##": { label: "sandstone wall", color: "#8a6a3a" },
  "~~": { label: "Nile water", color: "#2f7fb0" },
  "==": { label: "bridge", color: "#7a5230" },
  sb: { label: "sandbags", color: "#a89060" },
  tr: { label: "palm", color: "#2f6a2a" },
  bx: { label: "explosive oil jar", color: "#c0502a" },
  cr: { label: "crate", color: "#9a7040" },
  py: { label: "pyramid, 3x3 (top-left)", color: "#f0d080" },
  ob: { label: "obelisk", color: "#c8a868" },
  co: { label: "column", color: "#bfae8a" },
  an: { label: "Anubis statue", color: "#2a2a2a" },
  bt: { label: "Bastet (cat) statue", color: "#5a4a8a" },
};

export const UNIT_CODES: Record<string, { label: string; color: string }> = {
  "..": { label: "none", color: "transparent" },
  s1: { label: "mummy (rifleman)", color: "#e8e0c8" },
  s2: { label: "mummy priest (grenadier)", color: "#b8a0e0" },
  t1: { label: "sphinx tank, 2x2 (top-left)", color: "#d09030" },
  b1: { label: "guardian sphinx (bunker)", color: "#a06820" },
  h1: { label: "POW (rescue)", color: "#40c0ff" },
  g1: { label: "sandstorm pickup", color: "#ffd040" },
  c1: { label: "cat (joins your army)", color: "#ff60c0" },
  k1: { label: "Pharaoh's chariot boss", color: "#ff2020" },
};

/** Codes that cover more than their own cell, written in the top-left cell. */
export const FOOTPRINT: Record<string, number> = { py: 3, t1: 2 };

const ROW_LINE = /^(\d{3}) (.*)$/;

// Parses one grid block, strictly. Errors name the layer, row and column.
function parseBlock(layer: string, text: unknown, codes: Record<string, unknown>, errors: string[]): Grid {
  if (typeof text !== "string") {
    errors.push(`[map] ${layer} is missing (expected a ''' block)`);
    return [];
  }
  const grid: Grid = [];
  const lines = text.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  lines.forEach((line, i) => {
    const m = ROW_LINE.exec(line);
    const where = `${layer} row ${String(i).padStart(3, "0")}`;
    if (!m) return void errors.push(`${where}: must start with a 3-digit row number and one space: "${line.slice(0, 24)}"`);
    if (Number(m[1]) !== i) errors.push(`${where}: numbered ${m[1]}, expected ${String(i).padStart(3, "0")}`);
    const cells = m[2].split(" ");
    if (cells.length !== WIDTH) errors.push(`${where}: ${cells.length} cells, expected ${WIDTH} (cells are separated by one space)`);
    cells.forEach((cell, c) => {
      if (cell.length !== 2) errors.push(`${where} col ${c}: "${cell}" is not two characters`);
      else if (!(cell in codes)) errors.push(`${where} col ${c}: unknown ${layer} code "${cell}"`);
    });
    grid.push(cells);
  });
  return grid;
}

/** Turns the parsed TOML (or the editor's raw object) into a Level, or a list of readable errors. */
export function validateLevel(raw: unknown): Checked {
  const errors: string[] = [];
  const doc = (raw ?? {}) as { level?: Record<string, unknown>; map?: Record<string, unknown> };
  const meta = doc.level ?? {};
  const name = typeof meta.name === "string" && meta.name.trim() ? meta.name : "";
  if (!name) errors.push("[level] name is missing");
  if (meta.width !== WIDTH) errors.push(`[level] width must be ${WIDTH}`);
  const terrain = parseBlock("terrain", doc.map?.terrain, TERRAIN_CODES, errors);
  const units = parseBlock("units", doc.map?.units, UNIT_CODES, errors);
  if (terrain.length === 0) errors.push("terrain has no rows");
  if (terrain.length !== units.length) errors.push(`terrain has ${terrain.length} rows but units has ${units.length}`);
  if (meta.height !== terrain.length) errors.push(`[level] height is ${String(meta.height)} but the grids have ${terrain.length} rows`);

  // big things: the cells they cover must stay empty, and they must fit
  for (const [layer, grid] of [["terrain", terrain], ["units", units]] as const) {
    grid.forEach((row, r) => row.forEach((code, c) => {
      const n = FOOTPRINT[code];
      if (!n) return;
      if (r + n > grid.length || c + n > WIDTH) return void errors.push(`${layer} row ${pad(r)} col ${c}: "${code}" is ${n}x${n} and runs off the map`);
      for (let dr = 0; dr < n; dr++) for (let dc = 0; dc < n; dc++) {
        if (!dr && !dc) continue;
        const v = grid[r + dr]?.[c + dc];
        if (v !== "..") errors.push(`${layer} row ${pad(r + dr)} col ${c + dc}: must be ".." (covered by "${code}" at row ${pad(r)} col ${c})`);
      }
    }));
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, level: { name, width: WIDTH, height: terrain.length, terrain, units } };
}

/**
 * Paints one code into a grid and keeps the level valid: a big thing near the edge is nudged in to fit,
 * painting over part of a pyramid or tank removes it, and a big thing clears the space it needs.
 * Returns the cell actually used (the top-left of a big thing), or null if nothing changed.
 */
export function paintCell(grid: Grid, row: number, col: number, code: string) {
  const n = FOOTPRINT[code] ?? 1;
  const r = Math.max(0, Math.min(row, grid.length - n)), c = Math.max(0, Math.min(col, WIDTH - n));
  if (grid[r]?.[c] === undefined || grid[r][c] === code) return null;
  for (let dr = 0; dr < n; dr++) for (let dc = 0; dc < n; dc++) {
    removeCovering(grid, r + dr, c + dc);
    grid[r + dr][c + dc] = "..";
  }
  grid[r][c] = code;
  return { r, c };
}

/** Clears any pyramid or tank whose footprint covers (r, c). */
function removeCovering(grid: Grid, r: number, c: number) {
  for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
    const n = FOOTPRINT[grid[r - dr]?.[c - dc]];
    if (n && dr < n && dc < n) grid[r - dr][c - dc] = "..";
  }
}

const pad = (n: number) => String(n).padStart(3, "0");

export function gridToText(grid: Grid) {
  return grid.map((row, r) => `${pad(r)} ${row.join(" ")}`).join("\n");
}

/** The raw shape validateLevel() expects, from a Level (what the editor sends). */
export function levelToRaw(l: Level) {
  return { level: { name: l.name, width: l.width, height: l.terrain.length }, map: { terrain: gridToText(l.terrain), units: gridToText(l.units) } };
}

/** Writes a level as TOML, always in the same layout. */
export function toToml(l: Level) {
  const q = (s: string) => JSON.stringify(s); // TOML basic strings accept JSON escapes
  const legend = (codes: Record<string, { label: string }>) =>
    Object.entries(codes).map(([k, v]) => `${q(k)} = ${q(v.label)}`).join("\n");
  return `[level]
name = ${q(l.name)}
width = ${l.width}
height = ${l.terrain.length}

[legend.terrain]
${legend(TERRAIN_CODES)}

[legend.units]
${legend(UNIT_CODES)}

[map]
terrain = '''
${gridToText(l.terrain)}
'''
units = '''
${gridToText(l.units)}
'''
`;
}

// Loose parser for the bundled fallback grids in src/level.ts.
export function parseGrid(text: string): Grid {
  return text.trim().split("\n").map((line) => line.trim().split(/\s+/).slice(1));
}
