// The council, drawn as flat Kurzgesagt-style SVG: round bodies, big simple eyes, no outlines,
// two or three tones per shape. Each god blinks and idles (CSS in ui.ts); .speaking makes one stand.

import type { GodName } from "./catalog";

const EYE = (x: number, y: number, r = 7, iris = "#1b1f4b") => `
  <g class="eye"><circle cx="${x}" cy="${y}" r="${r}" fill="#fff"/><circle class="pupil" cx="${x + 1.5}" cy="${y + 0.5}" r="${r * 0.55}" fill="${iris}"/>
  <circle cx="${x - r * 0.25}" cy="${y - r * 0.35}" r="${r * 0.22}" fill="#fff"/><rect class="lid" x="${x - r - 1}" y="${y - r - 1}" width="${r * 2 + 2}" height="${r * 2 + 2}" rx="${r}"/></g>`;

/** Robe, collar and arms, shared by all five; the head sits on top. */
const BODY = (robe: string, shade: string) => `
  <ellipse cx="60" cy="146" rx="40" ry="7" fill="#11143a" opacity=".35"/>
  <path d="M28 146 Q26 96 60 92 Q94 96 92 146Z" fill="${robe}"/>
  <path d="M60 92 Q94 96 92 146 L70 146 Q76 110 60 92Z" fill="${shade}"/>
  <rect x="36" y="124" width="48" height="10" rx="4" fill="#f4f1ea"/>
  <path d="M34 100 Q60 124 86 100 Q60 112 34 100Z" fill="#ffd23f"/>
  <path d="M38 102 Q60 118 82 102" fill="none" stroke="#ff9f1c" stroke-width="3"/>
  <path d="M30 108 Q20 122 30 132" fill="none" stroke="${robe}" stroke-width="9" stroke-linecap="round"/>
  <path class="arm" d="M90 108 Q102 118 96 132" fill="none" stroke="${shade}" stroke-width="9" stroke-linecap="round"/>`;

const HEADS: Record<GodName, string> = {
  ra: `
    <g class="halo"><circle cx="60" cy="34" r="30" fill="#ff9f1c"/><circle cx="60" cy="34" r="24" fill="#ffd23f"/><circle cx="52" cy="26" r="6" fill="#fff" opacity=".6"/></g>
    <path d="M60 30 q-4 -10 0 -16 q4 6 0 16z" fill="#ff5e7e"/>
    <circle cx="60" cy="66" r="24" fill="#c97b3d"/><path d="M60 42 a24 24 0 0 1 24 24 h-24z" fill="#a8622e"/>
    <path d="M78 64 Q96 66 92 80 Q86 74 76 74Z" fill="#ffd23f"/><path d="M84 72 Q90 76 92 80 Q86 78 82 76Z" fill="#ff9f1c"/>
    ${EYE(66, 60, 7)}<path d="M60 68 q6 10 -2 18" fill="none" stroke="#1b1f4b" stroke-width="4" stroke-linecap="round"/>`,
  thoth: `
    <path class="halo" d="M42 22 a20 20 0 1 0 36 4 a15 15 0 1 1 -36 -4z" fill="#d6dcff"/>
    <path d="M60 92 Q48 84 50 66" fill="none" stroke="#f4f1ea" stroke-width="12" stroke-linecap="round"/>
    <circle cx="56" cy="58" r="20" fill="#f4f1ea"/><path d="M40 46 Q32 54 38 68 L46 64Z" fill="#1b1f4b"/>
    <path d="M70 60 Q96 64 108 92 Q103 94 101 89 Q88 72 68 67Z" fill="#1b1f4b"/>
    ${EYE(62, 55, 7, "#2ec4b6")}`,
  anubis: `
    <path d="M42 54 L36 14 L56 44Z" fill="#11143a"/><path d="M78 54 L84 14 L64 44Z" fill="#11143a"/>
    <path d="M44 48 L40 22 L52 44Z" fill="#6c5ce7"/><path d="M76 48 L80 22 L68 44Z" fill="#6c5ce7"/>
    <circle cx="60" cy="64" r="22" fill="#2a2d5c"/><path d="M70 58 Q100 62 102 74 Q96 82 72 78Z" fill="#2a2d5c"/>
    <circle cx="100" cy="72" r="4" fill="#11143a"/><path d="M48 58 h28" stroke="#ffd23f" stroke-width="4"/>
    ${EYE(64, 60, 6.5, "#ffd23f")}`,
  bastet: `
    <path d="M38 56 L40 26 L58 46Z" fill="#ff5e7e"/><path d="M82 56 L80 26 L62 46Z" fill="#e8476a"/>
    <path d="M43 50 L44 34 L54 46Z" fill="#ffb3c4"/><path d="M77 50 L76 34 L66 46Z" fill="#ffb3c4"/>
    <circle cx="60" cy="64" r="26" fill="#ff5e7e"/><path d="M60 38 a26 26 0 0 1 26 26 h-26z" fill="#e8476a"/>
    ${EYE(50, 62, 7, "#2ec4b6")}${EYE(70, 62, 7, "#2ec4b6")}
    <path d="M56 72 h8 l-4 4z" fill="#1b1f4b"/><path d="M60 76 q-6 6 -10 2 M60 76 q6 6 10 2" fill="none" stroke="#1b1f4b" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M30 70 h14 M30 76 h14 M76 70 h14 M76 76 h14" stroke="#ffd0dc" stroke-width="2" stroke-linecap="round"/>
    <circle cx="36" cy="80" r="4" fill="#ffd23f"/>`,
  sobek: `
    <g class="halo"><path d="M48 30 Q46 6 54 4 Q56 18 56 30Z" fill="#f4f1ea"/><path d="M72 30 Q74 6 66 4 Q64 18 64 30Z" fill="#f4f1ea"/><circle cx="60" cy="34" r="12" fill="#ffd23f"/></g>
    <circle cx="56" cy="64" r="22" fill="#1fb5a8"/><path d="M62 54 Q104 56 108 70 Q104 82 64 80Z" fill="#1fb5a8"/>
    <path d="M64 70 Q100 72 106 72 L104 80 Q80 82 64 80Z" fill="#17907f"/>
    <path d="M72 72 l3 5 l3 -5 M82 72 l3 5 l3 -5 M92 72 l3 5 l3 -5" fill="#fff"/>
    <path d="M40 58 q6 -4 12 0 q-6 4 -12 0z" fill="#17907f"/>
    ${EYE(60, 54, 7, "#ff9f1c")}`,
};

const ROBES: Record<GodName, [string, string]> = {
  ra: ["#ff9f1c", "#e07f00"], thoth: ["#2ec4b6", "#1f9e93"], anubis: ["#6c5ce7", "#5443c7"],
  bastet: ["#ff5e7e", "#e0435f"], sobek: ["#1fb5a8", "#14907f"],
};

export function godSvg(god: GodName) {
  const [robe, shade] = ROBES[god];
  return `<svg class="god-art" viewBox="0 0 120 156" aria-hidden="true"><g class="bob">${BODY(robe, shade)}<g class="head">${HEADS[god]}</g></g></svg>`;
}

/** The scales of Ma'at: a heart against a feather. The .beam tilts; data-tilt on the svg sets the verdict. */
export const SCALES = `
<svg class="scales" viewBox="0 0 220 170" aria-hidden="true">
  <ellipse cx="110" cy="162" rx="70" ry="7" fill="#11143a" opacity=".4"/>
  <rect x="80" y="146" width="60" height="14" rx="7" fill="#e9955a"/><rect x="86" y="142" width="48" height="8" rx="4" fill="#f6c177"/>
  <rect x="104" y="40" width="12" height="106" rx="6" fill="#ffd23f"/><rect x="104" y="40" width="5" height="106" rx="2.5" fill="#fff" opacity=".35"/>
  <circle cx="110" cy="36" r="10" fill="#ff9f1c"/>
  <g class="beam">
    <rect x="22" y="31" width="176" height="10" rx="5" fill="#ffd23f"/>
    <g class="pan left">
      <path d="M30 40 L14 92 M30 40 L46 92" stroke="#f4f1ea" stroke-width="2"/>
      <path d="M6 92 Q30 108 54 92Z" fill="#f6c177"/>
      <path class="heart" d="M30 90 C 18 80 18 68 26 68 C 29 68 30 71 30 72 C 30 71 31 68 34 68 C 42 68 42 80 30 90Z" fill="#ff5e7e"/>
    </g>
    <g class="pan right">
      <path d="M190 40 L174 92 M190 40 L206 92" stroke="#f4f1ea" stroke-width="2"/>
      <path d="M166 92 Q190 108 214 92Z" fill="#f6c177"/>
      <path class="feather" d="M184 90 Q178 74 192 58 Q200 74 186 90Z" fill="#f4f1ea"/><path d="M185 90 L191 62" stroke="#2ec4b6" stroke-width="2"/>
    </g>
  </g>
</svg>`;

/**
 * A bank of flat Kurzgesagt clouds as one SVG: puffy bumps on a flat-ish base, three tones (a warm golden
 * underside, a cream body, a sunlit top), little highlight puffs and a soft shadow. Seeded so it doesn't jump.
 */
export function cloudBank(opts: { width: number; height: number; seed: number; tones: [string, string, string]; shadow?: string }) {
  const { width: W, height: H, tones } = opts;
  let seed = opts.seed;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const base = H * 0.78;
  // puffs sized from the bank's height, so the bumps always fit; big and small alternate along the line
  const puffs: { x: number; y: number; r: number }[] = [];
  for (let x = -H * 0.2, i = 0; x < W + H * 0.3; i++) {
    const r = H * (i % 2 ? 0.2 + rnd() * 0.1 : 0.3 + rnd() * 0.16);
    puffs.push({ x, y: base - r * (0.45 + rnd() * 0.35), r });
    x += r * (1.05 + rnd() * 0.35);
  }
  // a scalloped underside too: a second row of smaller puffs along the base, no flat slab
  for (let x = 0; x < W; x += H * 0.22) puffs.push({ x: x + rnd() * H * 0.08, y: base, r: H * (0.14 + rnd() * 0.05) });
  const shape = (dx: number, dy: number, k: number) =>
    puffs.map((p) => `<circle cx="${(p.x + dx).toFixed(1)}" cy="${(p.y + dy).toFixed(1)}" r="${(p.r * k).toFixed(1)}"/>`).join("") +
    `<rect x="${-20 + dx}" y="${(base - H * 0.2 + dy).toFixed(1)}" width="${W + 40}" height="${(H * 0.2).toFixed(1)}"/>`;
  const highlights = puffs.filter((p) => p.r > H * 0.3).map((p) =>
    `<ellipse cx="${(p.x - p.r * 0.3).toFixed(1)}" cy="${(p.y - p.r * 0.5).toFixed(1)}" rx="${(p.r * 0.3).toFixed(1)}" ry="${(p.r * 0.15).toFixed(1)}" fill="#ffffff" opacity=".9"/>`).join("");
  return `<svg class="bank" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    ${opts.shadow ? `<g fill="${opts.shadow}" opacity=".3">${shape(8, 10, 1)}</g>` : ""}
    <g fill="${tones[0]}">${shape(0, 0, 1)}</g>
    <g fill="${tones[1]}">${shape(-3, -H * 0.05, 0.9)}</g>
    <g fill="${tones[2]}">${shape(-6, -H * 0.1, 0.7)}</g>
    ${highlights}
  </svg>`;
}
