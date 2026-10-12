// The council's powers: what the agent may ask for, and the strict check of what it asked.
// The agent never runs anything itself: it names powers from this list, and src/council/powers.ts
// plays them on the live game. Anything not in this list, or out of bounds, is dropped.

import type { WorldSnapshot } from "../scenes/GameScene";

export type GodName = "ra" | "thoth" | "anubis" | "bastet" | "sobek";

export type Power =
  | { power: "ascend"; to: "temple" | "boss" | "start" | number }
  | { power: "smite" | "entomb" | "banish" | "transform"; targets: number[] }
  | { power: "purify" }
  | { power: "shield"; seconds: number }
  | { power: "bless"; lives: number; sandstorms: number; score: number }
  | { power: "summon_cats"; n: number }
  | { power: "slow_time"; seconds: number }
  | { power: "reveal"; seconds: number }
  | { power: "defeat_boss" }
  | { power: "reshape"; rows: [number, number]; request: string };

export type PowerName = Power["power"];

export const GODS: Record<GodName, { name: string; title: string; color: string; voice: string }> = {
  ra: { name: "Ra", title: "the Sun", color: "#ff9f1c", voice: "grand, booming, a little vain" },
  thoth: { name: "Thoth", title: "the Scribe", color: "#2ec4b6", voice: "precise, scholarly, dry wit" },
  anubis: { name: "Anubis", title: "of the Underworld", color: "#6c5ce7", voice: "calm, solemn, deadpan" },
  bastet: { name: "Bastet", title: "of Cats", color: "#ff5e7e", voice: "playful, smug, purrs" },
  sobek: { name: "Sobek", title: "of the Nile", color: "#1fb5a8", voice: "blunt, hungry, comic" },
};

/** Who wields what (the animation and the god callout follow this). */
export const POWERS: Record<PowerName, { god: GodName; label: string; doc: string }> = {
  ascend: { god: "ra", label: "Ascension", doc: `{"power":"ascend","to":"temple"|"boss"|"start"|<row number>}  lift the pharaoh in a column of sunlight and set them down elsewhere ("temple" = the far end)` },
  smite: { god: "ra", label: "Smite", doc: `{"power":"smite","targets":[<enemy ids>]}  lightning from the sky kills these enemies` },
  entomb: { god: "sobek", label: "Entomb", doc: `{"power":"entomb","targets":[<enemy ids>]}  stone walls rise and seal these enemies in a tomb forever (the tomb becomes a wall)` },
  banish: { god: "anubis", label: "Banish", doc: `{"power":"banish","targets":[<enemy ids>]}  a portal to the underworld swallows these enemies` },
  transform: { god: "bastet", label: "Transform", doc: `{"power":"transform","targets":[<enemy ids>]}  these enemies turn into cats that join the pharaoh's cat army` },
  purify: { god: "thoth", label: "Purify", doc: `{"power":"purify"}  every enemy bullet and cat bomb in the air turns into a scarab and flies away` },
  shield: { god: "ra", label: "Sun shield", doc: `{"power":"shield","seconds":<1-20>}  nothing can hurt the pharaoh for a while` },
  bless: { god: "ra", label: "Blessing", doc: `{"power":"bless","lives":<0-3>,"sandstorms":<0-5>,"score":<0-5000>}  gifts` },
  summon_cats: { god: "bastet", label: "Summon cats", doc: `{"power":"summon_cats","n":<1-100>}  cats float down from the sky and join the army` },
  slow_time: { god: "thoth", label: "Slow time", doc: `{"power":"slow_time","seconds":<1-15>}  enemies and their shots move at a third of their speed` },
  reveal: { god: "thoth", label: "Eye of Ra", doc: `{"power":"reveal","seconds":<1-30>}  no darkness: the pharaoh sees everything, through walls` },
  defeat_boss: { god: "ra", label: "Sun fall", doc: `{"power":"defeat_boss"}  a sun disc falls on the Pharaoh's chariot (only if there is a boss)` },
  reshape: { god: "thoth", label: "Reshape the land", doc: `{"power":"reshape","rows":[<first row>,<last row>],"request":"<what to change in those rows>"}  rewrite part of the map (at most 14 rows; the rows run 0 = temple to the bottom)` },
};

export const PRANKS = ["tiny", "frog", "camel", "confetti", "cat"] as const;
export type Prank = (typeof PRANKS)[number];

export type Decree = {
  speaker: GodName;
  speech: string;
  actions: Power[];
  prank: Prank | null;
  agentMessage: string;
  /** Other gods butting in: short, petty, funny. */
  asides: { god: GodName; line: string }[];
};

const clamp = (v: unknown, lo: number, hi: number, d = lo) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : d;
  return Math.max(lo, Math.min(hi, Math.round(n)));
};

/**
 * Turns whatever the agent wrote into powers we are willing to run. Unknown powers, ids that are not
 * live enemies, missing fields: dropped, with a reason the player is shown.
 */
export function validateActions(raw: unknown, world: WorldSnapshot, granted: boolean): { actions: Power[]; dropped: string[] } {
  const dropped: string[] = [];
  const actions: Power[] = [];
  const list = Array.isArray(raw) ? raw : [];
  if (!granted && list.length) dropped.push("the council refused, so its powers stay sheathed");
  if (!granted) return { actions, dropped };
  const ids = new Set(world.enemies.map((e) => e.id));
  if (world.boss) ids.add(world.boss.id);
  for (const item of list.slice(0, 5)) {
    const a = (item ?? {}) as Record<string, unknown>;
    const name = a.power as PowerName;
    if (!(typeof name === "string" && name in POWERS)) { dropped.push(`unknown power "${String(a.power)}"`); continue; }
    switch (name) {
      case "ascend": {
        const to = a.to;
        if (to === "temple" || to === "boss" || to === "start") actions.push({ power: name, to });
        else if (typeof to === "number") actions.push({ power: name, to: clamp(to, 1, world.rows - 2) });
        else dropped.push(`ascend: unknown destination "${String(to)}"`);
        break;
      }
      case "smite": case "entomb": case "banish": case "transform": {
        const asked = Array.isArray(a.targets) ? a.targets.filter((t): t is number => typeof t === "number") : [];
        const live = [...new Set(asked)].filter((t) => ids.has(t)).slice(0, 30);
        if (asked.length > live.length) dropped.push(`${name}: ${asked.length - live.length} target(s) are not live enemies`);
        if (live.length) actions.push({ power: name, targets: live });
        break;
      }
      case "purify": case "defeat_boss":
        if (name === "defeat_boss" && !world.boss) { dropped.push("defeat_boss: there is no boss to defeat"); break; }
        actions.push({ power: name });
        break;
      case "shield": actions.push({ power: name, seconds: clamp(a.seconds, 1, 20, 8) }); break;
      case "slow_time": actions.push({ power: name, seconds: clamp(a.seconds, 1, 15, 8) }); break;
      case "reveal": actions.push({ power: name, seconds: clamp(a.seconds, 1, 30, 12) }); break;
      case "summon_cats": actions.push({ power: name, n: clamp(a.n, 1, 100, 5) }); break; // above 100 the summoning gets slow
      case "bless": {
        const b = { power: name, lives: clamp(a.lives, 0, 3, 0), sandstorms: clamp(a.sandstorms, 0, 5, 0), score: clamp(a.score, 0, 5000, 0) } as const;
        if (b.lives || b.sandstorms || b.score) actions.push(b);
        else dropped.push("bless: an empty gift");
        break;
      }
      case "reshape": {
        const rows = Array.isArray(a.rows) ? a.rows : [];
        const r0 = clamp(rows[0], 0, world.rows - 1, -1), r1 = clamp(rows[1], 0, world.rows - 1, -1);
        const request = typeof a.request === "string" ? a.request.slice(0, 300) : "";
        if (r0 < 0 || r1 < 0 || !request) { dropped.push("reshape: needs rows and a request"); break; }
        const lo = Math.min(r0, r1), hi = Math.min(Math.max(r0, r1), lo + 13);
        actions.push({ power: name, rows: [lo, hi], request });
        break;
      }
    }
  }
  // the land changes last: it rebuilds the world around the player
  actions.sort((x, y) => Number(x.power === "reshape") - Number(y.power === "reshape"));
  return { actions, dropped };
}
