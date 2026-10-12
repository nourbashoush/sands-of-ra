// Gameplay rules shared by the game and the level checker (the oracle's proposals, src/oracle/).
// No Phaser here. Walkable is what the player can walk on; everything else blocks
// (barrels and crates count as blocking even though they can be shot).

import { FOOTPRINT, validateLevel, levelToRaw, WIDTH, type Grid, type Level } from "./levelFormat";

export const WALKABLE = new Set(["..", "rd", "==", "pv", "ff", "rs"]);
export const ROAD = new Set(["rd", "=="]);

/** The player starts at the bottom centre: second-to-last row, columns 7 and 8. */
export const startCells = (rows: number) => [{ r: rows - 2, c: 7 }, { r: rows - 2, c: 8 }];

export const ENEMY_CODES = new Set(["s1", "s2", "t1", "b1", "k1"]);
export const PICKUP_CODES = new Set(["h1", "g1", "c1"]);
/** Units that stand in the way like a wall: tanks (2x2) and the guardian sphinx. */
const BLOCKING_UNITS = new Set(["t1", "b1"]);
const SAFE_RADIUS = 4;

export type Check = { ok: boolean; label: string; detail?: string };

/** Which cells block movement: unwalkable terrain, pyramid and tank footprints, bunkers. */
export function blockedMap(level: Level) {
  const rows = level.terrain.length;
  const blocked: boolean[][] = level.terrain.map((row) => row.map((code) => !WALKABLE.has(code)));
  const cover = (grid: Grid, isBlock: (code: string) => boolean) => grid.forEach((row, r) => row.forEach((code, c) => {
    if (!isBlock(code)) return;
    const n = FOOTPRINT[code] ?? 1;
    for (let dr = 0; dr < n; dr++) for (let dc = 0; dc < n; dc++) if (r + dr < rows && c + dc < WIDTH) blocked[r + dr][c + dc] = true;
  }));
  cover(level.terrain, (code) => code === "py");
  cover(level.units, (code) => BLOCKING_UNITS.has(code));
  return blocked;
}

/** Every cell reachable on foot from the player's start (4-neighbour flood fill). */
export function reachable(level: Level, blocked = blockedMap(level)) {
  const rows = level.terrain.length;
  const seen: boolean[][] = blocked.map((row) => row.map(() => false));
  const queue: [number, number][] = [];
  for (const { r, c } of startCells(rows)) if (!blocked[r]?.[c]) { seen[r][c] = true; queue.push([r, c]); }
  for (let i = 0; i < queue.length; i++) {
    const [r, c] = queue[i];
    for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      if (nr < 0 || nr >= rows || nc < 0 || nc >= WIDTH || seen[nr][nc] || blocked[nr][nc]) continue;
      seen[nr][nc] = true;
      queue.push([nr, nc]);
    }
  }
  return seen;
}

/** Is there a way on foot from the start to the top row? If not, the highest row reached. */
export function pathBottomToTop(level: Level) {
  const seen = reachable(level);
  const top = seen.findIndex((row) => row.some(Boolean));
  return { ok: top === 0, highest: top };
}

const pad = (n: number) => String(n).padStart(3, "0");

/** Problems of one kind in a level, as a set of "row:col" keys, so before/after can be compared. */
function problems(level: Level) {
  const blocked = blockedMap(level);
  const seen = reachable(level, blocked);
  const rows = level.terrain.length;
  const out = { offWalk: new Map<string, string>(), tankOffRoad: new Map<string, string>(), nearStart: new Map<string, string>(), unreachable: new Map<string, string>() };
  const near = (r: number, c: number) => startCells(rows).some((s) => Math.hypot(s.r - r, s.c - c) <= SAFE_RADIUS);
  level.units.forEach((row, r) => row.forEach((code, c) => {
    if (code === "..") return;
    const key = `${r}:${c}`, where = `row ${pad(r)} col ${c}`;
    const n = FOOTPRINT[code] ?? 1;
    if (code !== "t1" && !WALKABLE.has(level.terrain[r][c])) out.offWalk.set(key, `${code} at ${where} stands on "${level.terrain[r][c]}"`);
    if (code === "t1") {
      for (let dr = 0; dr < n; dr++) for (let dc = 0; dc < n; dc++) {
        if (!ROAD.has(level.terrain[r + dr]?.[c + dc])) { out.tankOffRoad.set(key, `the sphinx tank at ${where} is not fully on road`); break; }
      }
    }
    if (ENEMY_CODES.has(code) && near(r, c)) out.nearStart.set(key, `${code} at ${where} is within ${SAFE_RADIUS} tiles of the player's start`);
    if (PICKUP_CODES.has(code)) {
      const ok = [[r, c], [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(([a, b]) => seen[a]?.[b]);
      if (!ok) out.unreachable.set(key, `${code} at ${where} cannot be reached on foot`);
    }
  }));
  return out;
}

/**
 * Checks a proposed level against the current one. A check only fails for problems the change
 * introduced: a mummy that already stood on a wall is not the oracle's fault.
 */
export function checkLevel(before: Level, after: Level, allowedRows: [number, number]): Check[] {
  const checks: Check[] = [];
  const format = validateLevel(levelToRaw(after));
  checks.push(format.ok ? { ok: true, label: "Carved in the right format" } : { ok: false, label: "Carved in the right format", detail: format.errors.slice(0, 3).join("; ") });
  if (!format.ok) return checks;

  // only the chosen rows changed
  const outside: number[] = [];
  for (let r = 0; r < after.terrain.length; r++) {
    if (r >= allowedRows[0] && r <= allowedRows[1]) continue;
    if (after.terrain[r].join() !== before.terrain[r]?.join() || after.units[r].join() !== before.units[r]?.join()) outside.push(r);
  }
  checks.push(outside.length ? { ok: false, label: "Only the chosen rows changed", detail: `also changed row ${outside.slice(0, 4).map(pad).join(", ")}` } : { ok: true, label: "Only the chosen rows changed" });

  const path = pathBottomToTop(after), pathBefore = pathBottomToTop(before);
  checks.push(path.ok || !pathBefore.ok
    ? { ok: true, label: "A way from the bottom to the top" }
    : { ok: false, label: "A way from the bottom to the top", detail: `blocked: on foot you get no further than row ${pad(path.highest)}` });

  const pb = problems(before), pa = problems(after);
  const fresh = (a: Map<string, string>, b: Map<string, string>) => [...a].filter(([k]) => !b.has(k)).map(([, v]) => v);
  const add = (label: string, list: string[]) => checks.push(list.length ? { ok: false, label, detail: list.slice(0, 3).join("; ") } : { ok: true, label });
  add("Everyone stands on solid ground", fresh(pa.offWalk, pb.offWalk));
  add("Sphinx tanks sit on the road", fresh(pa.tankOffRoad, pb.tankOffRoad));
  add("A safe start for the pharaoh", fresh(pa.nearStart, pb.nearStart));
  add("Every prize can be reached", fresh(pa.unreachable, pb.unreachable));
  return checks;
}
