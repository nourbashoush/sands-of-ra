// The council without Claude: a small model trained in wish-model/train.py picks the power(s), a few
// rules read the numbers and targets, and pre-written lines give the gods something to say. It
// answers with the same JSON Claude would, so readDecree (reply.ts) checks it and the powers run the
// same way. Nothing leaves the browser: the model is public/wish-model.json, fetched on the first wish.

import type { WorldSnapshot } from "../scenes/GameScene";
import { GODS, POWERS, PRANKS, type GodName, type PowerName } from "./catalog";

type Model = { labels: string[]; pieces: string[]; bias: number[]; scale: number; weights: string };
type Values = { n?: number; seconds?: number; lives?: number; sandstorms?: number; score?: number; target?: string; to?: string };

let loaded: Promise<{ model: Model; weights: Int8Array; columnOf: Map<string, number> }> | null = null;
function loadModel() {
  loaded ??= fetch(`${import.meta.env.BASE_URL}wish-model.json`)
    .then((res) => res.json() as Promise<Model>)
    .then((model) => ({
      model,
      weights: Int8Array.from(atob(model.weights), (c) => (c.charCodeAt(0) << 24) >> 24), // labels x pieces
      columnOf: new Map(model.pieces.map((piece, i) => [piece, i])),
    }));
  return loaded;
}

// --- 1. The model: the same as normalise(), pieces(), score_wish() and pick_intents() in wish-model/train.py ---

function normalise(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // accents
    .replace(/\?+/g, " ? ")
    .replace(/[^a-z0-9? ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function pieces(text: string) {
  const words = normalise(text).split(" ").filter(Boolean);
  const out = words.map((word) => "w:" + word);
  for (let i = 0; i + 1 < words.length; i++) out.push("p:" + words[i] + " " + words[i + 1]);
  for (const word of words) {
    const padded = ` ${word} `;
    for (const n of [2, 3, 4]) for (let i = 0; i + n <= padded.length; i++) out.push(padded.slice(i, i + n));
  }
  return out;
}

async function pickIntents(text: string) {
  const { model, weights, columnOf } = await loadModel();
  const counts = new Map<number, number>();
  for (const piece of pieces(text)) {
    const column = columnOf.get(piece);
    if (column !== undefined) counts.set(column, (counts.get(column) ?? 0) + 1);
  }
  const length = Math.sqrt([...counts.values()].reduce((sum, c) => sum + c * c, 0)) || 1;

  const scores = model.labels.map((label, k) => {
    let z = model.bias[k];
    for (const [column, count] of counts) z += weights[k * model.pieces.length + column] * model.scale * (count / length);
    return { label, score: 1 / (1 + Math.exp(-z)) };
  });
  const [best, second] = scores.sort((a, b) => b.score - a.score);

  const picked = [best.label];
  if (second.score > 0.5 && best.label !== "none" && second.label !== "none") picked.push(second.label);
  return picked;
}

// --- 2. The values, by rule: numbers, targets and places, read straight from the words ---------------

const TARGETS: [string, string[]][] = [
  ["boss", ["chariot", "boss"]],
  ["sphinx_tank", ["tank", "tanks", "sphinx tank"]],
  ["guardian", ["guardian", "turret", "guard"]],
  ["priest", ["priest", "preist"]],
  ["mummy", ["mummy", "mummies", "mumm"]],
  ["nearest", ["nearest", "closest", "in front", "this one", "that one", "next one"]],
  ["on_screen", ["on screen", "onscreen", "i can see", "around me", "nearby", "in view", "visible"]],
  ["all", ["all", "every", "everyone", "everything", "everybody", "evry", "whole", "entire"]],
];
const PLACES: [string, string[]][] = [
  ["boss", ["boss", "chariot"]],
  ["start", ["start", "beginning", "begining", "spawn", "restart"]],
  ["temple", ["temple", "end", "finish", "final", "goal", "exit"]],
];
const GIFTS: [keyof Values, string[]][] = [
  ["lives", ["life", "lives", "lifes", "hearts", "heart", "1up"]],
  ["sandstorms", ["sandstorm", "sandstorms", "storm", "storms", "sand"]],
  ["score", ["points", "point", "score", "pts"]],
];
const TIMED_WORDS: Record<string, string[]> = {
  shield: ["shield", "invincible", "protect", "safe"],
  slow_time: ["slow", "time", "slowmo"],
  reveal: ["see", "light", "reveal", "vision", "xray"],
};
const CAT_WORDS = ["cat", "cats", "kitties", "kitty", "kats", "kittens"];
const TARGETED: PowerName[] = ["smite", "entomb", "banish", "transform"];
const UNIT = /^(s|sec|secs|second|seconds|min)$/;
const ONES: Record<string, number> = {
  zero: 0, one: 1, won: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, dozen: 12, couple: 2,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NOT_NUMBERS = new Set(["none", "fine", "seen", "line", "mine", "wine", "nice", "tin", "tan", "net", "tee", "toe", "fir", "fur", "sex", "sit", "sir", "eighth", "sixth", "tent", "teen"]);
const NUMBER_WORDS = [...Object.keys(ONES), ...Object.keys(TENS), "hundred", "thousand"];

function editDistance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}

function near(word: string, key: string) {
  if (word === key) return true;
  if (key.length < 5) return key.length >= 4 && word.startsWith(key) && word.length - key.length <= 2;
  if (word.startsWith(key) && word.length - key.length <= 3) return true;
  return word[0] === key[0] && editDistance(word, key) <= (key.length >= 7 ? 2 : 1);
}

function mentions(words: string[], keys: string[]) {
  const text = words.join(" "), joined = words.join("");
  return keys.some((key) => key.includes(" ")
    ? text.includes(key) || joined.includes(key.replace(/ /g, ""))
    : words.some((word) => near(word, key)) || (key.length >= 6 && joined.includes(key)));
}

function asNumberWord(word: string) {
  if (word in ONES || word in TENS || word === "hundred" || word === "thousand") return word;
  if (word.length < 3 || NOT_NUMBERS.has(word)) return word;
  const swapped = (a: string, b: string) => a.length === b.length && [...a].filter((c, i) => c !== b[i]).length === 2 && [...a].sort().join() === [...b].sort().join();
  const match = NUMBER_WORDS.find((number) => number.length >= 3 && number[0] === word[0]
    && (word.length === 3 ? swapped(word, number) : editDistance(word, number) <= 1 || swapped(word, number)));
  return match ?? word;
}

function speltNumber(words: string[], i: number) {
  let total = 0, current = 0, j = i;
  for (; j < words.length; j++) {
    const word = asNumberWord(words[j]), next = asNumberWord(words[j + 1] ?? "");
    if (word in TENS) current += TENS[word];
    else if (word in ONES) current += ONES[word];
    else if ((word === "a" || word === "an") && /^(hundred|thousand|dozen|couple)$/.test(next)) current += 1;
    else if (word === "hundred" || word === "hunnid") current = (current || 1) * 100;
    else if (word === "thousand") { total += (current || 1) * 1000; current = 0; }
    else break;
  }
  return j > i ? { value: total + current, end: j } : null;
}

type Found = { value: number; at: number; unit: boolean };
function findNumbers(words: string[]) {
  const found: Found[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i], next = words[i + 1] ?? "";
    const digits = word.match(/^(\d+)([a-z]*)$/);
    if (digits) {
      const [, number, suffix] = digits;
      const meansForOrTo = (number === "4" || number === "2") && !suffix && /^\d/.test(next); // "shield 4 15 secs"
      if (!meansForOrTo) found.push({ value: +number, at: i, unit: UNIT.test(suffix) || UNIT.test(next) });
      continue;
    }
    const spelt = speltNumber(words, i);
    if (spelt) { found.push({ value: spelt.value, at: i, unit: UNIT.test(words[spelt.end] ?? "") }); i = spelt.end - 1; continue; }
    for (const match of word.matchAll(/(?<=[a-z])(\d+)(?=[a-z]|$)/g)) found.push({ value: +match[1], at: i, unit: /^\d+s/.test(word.slice(match.index)) });
  }
  return found;
}

function readValues(text: string, picked: string[]): Values {
  const words = normalise(text.replace(/(\d),(?=\d{3}\b)/g, "$1")).split(" ").filter(Boolean);
  const numbers = findNumbers(words), used = new Set<Found>(), values: Values = {};
  const take = (number: Found | null | undefined) => { if (!number) return undefined; used.add(number); return number.value; };
  const unused = (number: Found) => !used.has(number);
  const numberNear = (keys: string[]) => {
    let best: Found | null = null, bestGap = 4;
    words.forEach((word, at) => {
      if (!keys.some((key) => near(word, key) || word.includes(key))) return;
      for (const number of numbers.filter(unused)) {
        const gap = at >= number.at ? at - number.at : number.at - at + 0.5;
        if (gap < bestGap) [best, bestGap] = [number, gap];
      }
    });
    return best;
  };

  if (picked.some((p) => TARGETED.includes(p as PowerName))) values.target = TARGETS.find(([, keys]) => mentions(words, keys))?.[0];
  if (picked.includes("ascend")) {
    let lastAt = -1;
    for (const [place, keys] of PLACES) words.forEach((word, at) => { if (at > lastAt && keys.some((key) => near(word, key))) [lastAt, values.to] = [at, place]; });
  }
  if (picked.includes("bless")) {
    for (const [gift, keys] of GIFTS) {
      const named = words.some((word) => keys.some((key) => near(word, key)));
      const extraLife = gift === "lives" && /extra life|another life|one more (life|try)/.test(words.join(" "));
      if (named || extraLife) (values as Record<string, number>)[gift] = take(numberNear(keys)) ?? 1;
    }
  }
  for (const power of ["shield", "slow_time", "reveal"]) {
    if (picked.includes(power)) values.seconds = take(numbers.find((n) => n.unit && unused(n)) ?? numberNear(TIMED_WORDS[power]) ?? numbers.find(unused));
  }
  if (picked.includes("summon_cats")) values.n = take(numberNear(CAT_WORDS) ?? numbers.find((n) => unused(n) && !n.unit));
  return values;
}

// --- 3. From the model's answer to the council's decree ------------------------------------------------

/** The live enemies a target means: a type, the nearest one, the ones on screen, or all of them. */
function enemiesFor(target: string | undefined, world: WorldSnapshot): number[] {
  const all = [...world.enemies.map((e) => ({ id: e.id, type: e.type, onScreen: e.onScreen, distance: e.distance })),
    ...(world.boss ? [{ id: world.boss.id, type: "pharaoh_chariot", onScreen: true, distance: 0 }] : [])];
  const TYPE: Record<string, string> = { mummy: "mummy", priest: "mummy_priest", sphinx_tank: "sphinx_tank", guardian: "guardian_sphinx", boss: "pharaoh_chariot" };
  if (target && TYPE[target]) return all.filter((e) => e.type === TYPE[target]).map((e) => e.id);
  if (target === "all") return all.map((e) => e.id);
  const seen = world.enemies.filter((e) => e.onScreen).sort((a, b) => a.distance - b.distance);
  const nearest = (seen.length ? seen : [...world.enemies].sort((a, b) => a.distance - b.distance)).slice(0, 1).map((e) => e.id);
  if (target === "nearest") return nearest;
  // On screen, or no target given: the ones you can see, or the nearest one if none are in view.
  return seen.length ? seen.map((e) => e.id) : nearest;
}

function action(power: string, values: Values, world: WorldSnapshot) {
  switch (power) {
    case "summon_cats": return { power, n: values.n ?? 5 };
    case "smite": case "entomb": case "banish": case "transform": return { power, targets: enemiesFor(values.target, world) };
    case "shield": case "slow_time": case "reveal": return { power, seconds: values.seconds };
    case "bless": return { power, lives: values.lives ?? (values.sandstorms || values.score ? 0 : 1), sandstorms: values.sandstorms ?? 0, score: values.score ?? 0 };
    case "ascend": return { power, to: values.to ?? "temple" };
    case "purify": case "defeat_boss": return { power };
    default: return null; // reshape needs Claude to redraw the map, so it can't be done here
  }
}

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

const GRANTED: Record<string, string[]> = {
  summon_cats: ["Cats! Cats from the heavens! You're welcome.", "My children, go. Purr menacingly.", "The sky rains whiskers. As it should."],
  smite: ["BEHOLD! Lightning, as is my right.", "I have smitten them. Smote? Smited. Gone, anyway.", "The sun takes offence. So does the sky."],
  entomb: ["Into the stone with you. Forever. Bon appétit, eternity.", "Walls! Lovely, thick, unhungry walls. Mostly.", "Sealed. Don't knock."],
  banish: ["The underworld has room. It always has room.", "Off you go. Mind the step.", "Weighed, found wanting, posted downstairs."],
  transform: ["Now they are cats. An improvement in every way.", "Fluffy at last. Behave, my new darlings.", "Enemies? No. Kittens. Yours now."],
  purify: ["Every bolt in the air: scarabs. You may thank the scribe.", "Projectiles, reclassified as beetles.", "Corrected. The air is clean."],
  shield: ["Hide behind my glory. Plenty to go round.", "Nothing touches you now. Briefly.", "A shield of sunlight. Try not to squint."],
  slow_time: ["Time, slowed. Do not ask how. It is complicated.", "There. Everything now moves at the speed of committee.", "I have adjusted the calendar."],
  reveal: ["Let there be light. And there is. Through walls.", "The Eye of Ra opens. Nothing hides.", "Darkness, revoked."],
  bless: ["Gifts! From me! Naturally.", "Blessings, wrapped and ribboned.", "Take these, and try to keep them this time."],
  ascend: ["Up you go, on a beam of my finest sunlight.", "Hold still. Ascension is undignified if you wriggle.", "Transported. Leave a nice review."],
  defeat_boss: ["A falling sun for the chariot. Subtle, no?", "The Pharaoh's chariot has been… rescheduled.", "I dropped the sun on it. You're welcome."],
};
const CANT: string[] = [
  "Even gods have limits. That is one of them.",
  "The council has read your wish twice and still has questions.",
  "We do lightning, cats and sunlight. That was none of those.",
  "Lovely wish. Wrong pantheon.",
];
const REFUSED: Record<GodName, string[]> = {
  ra: ["No. The sun has spoken, and it said no.", "I would, but I'm busy being magnificent."],
  thoth: ["Denied, in triplicate.", "I have checked the scrolls. The answer is no."],
  anubis: ["The scales say no. I don't argue with the scales.", "Not today. Perhaps in the afterlife."],
  bastet: ["Mm, no. Ask nicer. Or don't.", "I'm napping. Wish later."],
  sobek: ["No. Hungry. Go away.", "Sobek says no. Sobek is a crocodile. Respect."],
};
const ASIDES: string[] = ["Show-off.", "I'd have done it better.", "Again with this mortal.", "Can we go home now?", "Write that down, Thoth.", "Don't encourage them."];

/**
 * The whole council, locally: the same JSON Claude would write, for readDecree (reply.ts) to check.
 * `granted` is decided before (the scales of Ma'at refuse one wish in ten), as with Claude.
 */
export async function localCouncil(wish: string, world: WorldSnapshot, granted: boolean): Promise<string> {
  const picked = await pickIntents(wish);
  const values = readValues(wish, picked);
  const actions = granted ? picked.map((power) => action(power, values, world)).filter(Boolean) : [];

  const first = actions[0]?.power as PowerName | undefined;
  const gods = Object.keys(GODS) as GodName[];
  const speaker: GodName = first ? POWERS[first].god : pick(gods);
  const speech = !granted ? pick(REFUSED[speaker]) : first ? pick(GRANTED[first]) : pick(CANT);
  const other = pick(gods.filter((g) => g !== speaker));

  return JSON.stringify({
    speaker,
    speech,
    asides: [{ god: other, line: pick(ASIDES) }],
    actions,
    prank: granted ? null : Math.random() < 0.5 ? pick(PRANKS) : null,
    agent_message: `wish-lab model: ${picked.join(" + ")} ${JSON.stringify(values)}`,
  });
}
