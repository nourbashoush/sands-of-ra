// Kurzgesagt-like house style: flat rounded shapes, no outlines, 2-3 tones per object
// (base, shade, highlight), light from the top-left, soft indigo shadows.

export type Ctx = CanvasRenderingContext2D;
/** Adds sub-paths to the current path (no beginPath inside), so shapes can be filled, clipped and offset. */
export type PathFn = (ctx: Ctx) => void;

export const FONT = `"Arial Rounded MT Bold", "Avenir Next", Arial, sans-serif`;

export const PAL = {
  night: "#11143a", // darkest indigo
  indigo: "#1b1f4b", // shadow colour
  violet: "#3a2d6b",
  lilac: "#6c5ce7",
  sand: "#f6c177",
  sandShade: "#e9955a",
  sandLight: "#f9dcaa",
  teal: "#1fb5a8",
  tealLight: "#2ec4b6",
  pink: "#ff5e7e",
  yellow: "#ffd23f",
  orange: "#ff9f1c",
  ink: "#f4f1ea",
  // supporting tones
  red: "#e84855",
  lapis: "#3d6fd9",
  lapisDark: "#2a4aa8",
  green: "#3fbf7f",
  greenDark: "#25936a",
  greenLight: "#8be08f",
  wood: "#c8733a",
  woodDark: "#8f4a2a",
  woodLight: "#e8a060",
  linen: "#f4f1ea",
  linenShade: "#c9c3e0",
};

export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const TAU = Math.PI * 2;

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
/** "#rrggbb" with an alpha, as rgba(). */
export const rgba = (c: string, a: number) => `rgba(${hex(c).join(",")},${a})`;
/** Mix two "#rrggbb" colours. */
export function mix(a: string, b: string, t: number) {
  const A = hex(a), B = hex(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
/** Shade tone: darker and pulled towards indigo, as in the reference style. */
export const shadeOf = (c: string, t = 0.3) => mix(c, PAL.indigo, t);
/** Highlight tone: lighter and warmer. */
export const lightOf = (c: string, t = 0.35) => mix(c, "#fff6e0", t);

// ---------------------------------------------------------------- paths

export const circleP = (x: number, y: number, r: number): PathFn => (ctx) => { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); };
export const ellipseP = (x: number, y: number, rx: number, ry: number, rot = 0): PathFn => (ctx) => {
  ctx.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx);
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
};
export const rrectP = (x: number, y: number, w: number, h: number, r: number): PathFn => (ctx) => { ctx.roundRect(x, y, w, h, r); };
export const polyP = (pts: number[]): PathFn => (ctx) => {
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
};
/** Several shapes as one (a union, as long as they all wind the same way). */
export const unionP = (...parts: PathFn[]): PathFn => (ctx) => parts.forEach((p) => p(ctx));

// ---------------------------------------------------------------- painting

export function fill(ctx: Ctx, path: PathFn, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath(); path(ctx); ctx.fill();
}

/**
 * The house shading: a base shape with a highlight rim on the lit (top-left) edge and
 * a shade crescent on the far (bottom-right) edge. `hi`/`sh` are the rim widths in pixels.
 */
export function lit(ctx: Ctx, path: PathFn, base: string, opts: { light?: string; shade?: string; hi?: number; sh?: number } = {}) {
  const light = opts.light ?? lightOf(base), shade = opts.shade ?? shadeOf(base), h = opts.hi ?? 2, s = opts.sh ?? 4;
  ctx.save();
  ctx.beginPath(); path(ctx); ctx.clip();
  fill(ctx, path, h > 0 ? light : base);
  if (h > 0) { ctx.translate(h, h); fill(ctx, path, base); ctx.translate(-h, -h); }
  if (s > 0) {
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.rect(-1e4, -1e4, 2e4, 2e4);
    ctx.translate(-s, -s); path(ctx); ctx.translate(s, s);
    ctx.fill("evenodd");
  }
  ctx.restore();
}

/** Long soft cast shadow, falling bottom-right: the shape smeared along (dx, dy) in thin indigo layers. */
export function castShadow(ctx: Ctx, path: PathFn, dx: number, dy: number, alpha = 0.35, color = PAL.indigo) {
  const n = 10;
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 1; i <= n; i++) {
    ctx.globalAlpha = (alpha / n) * 1.6 * (1 - i / (n + 2));
    ctx.save(); ctx.translate((dx * i) / n, (dy * i) / n);
    ctx.beginPath(); path(ctx); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** A soft round shadow blob. */
export function softBlob(ctx: Ctx, x: number, y: number, rx: number, ry: number, alpha = 0.3, color = PAL.indigo) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.6, rgba(color, alpha * 0.7));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
  ctx.restore();
}

/** A thin bright edge along the lit side of a shape (on top of whatever is painted). */
export function rimLight(ctx: Ctx, path: PathFn, color = "#ffffff", w = 1.5, alpha = 0.6) {
  ctx.save();
  ctx.beginPath(); path(ctx); ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.rect(-1e4, -1e4, 2e4, 2e4);
  ctx.translate(w, w); path(ctx);
  ctx.fill("evenodd");
  ctx.restore();
}

/** Cute big simple eye: white, a dark pupil looking along (lx, ly), one sparkle. */
export function eye(ctx: Ctx, x: number, y: number, r: number, lx = 1, ly = 0, white = "#ffffff", pupil = PAL.night) {
  fill(ctx, circleP(x, y, r), white);
  fill(ctx, circleP(x + lx * r * 0.35, y + ly * r * 0.35, r * 0.6), pupil);
  fill(ctx, circleP(x + lx * r * 0.2 - r * 0.25, y + ly * r * 0.2 - r * 0.3, Math.max(0.6, r * 0.22)), "#ffffff");
}

/** Flat starburst: n spikes between radii rIn and rOut. */
export function starP(cx: number, cy: number, rOut: number, rIn: number, n: number, rot = 0, jitter = 0): PathFn {
  const pts: number[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * TAU, r = (i % 2 ? rIn : rOut) * (1 + (i % 2 ? 0 : rnd(-jitter, jitter)));
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return polyP(pts);
}

/** A rounded puff cloud: a big middle lobe and a ring of smaller ones. */
export function puffP(cx: number, cy: number, r: number, lobes = 7, seed = Math.random()): PathFn {
  const parts: PathFn[] = [circleP(cx, cy, r * 0.62)];
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * TAU + seed * TAU, rr = r * (0.3 + 0.12 * Math.sin(i * 2.7 + seed * 9));
    const d = r - rr;
    parts.push(circleP(cx + Math.cos(a) * d * 0.85, cy + Math.sin(a) * d * 0.85, rr));
  }
  return unionP(...parts);
}

/** Subtle film grain over the whole canvas area given. */
export function grain(ctx: Ctx, w: number, h: number, n: number, alpha = 0.06, colors = ["#ffffff", PAL.indigo]) {
  ctx.save();
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = alpha * rnd(0.4, 1);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(rnd(0, w), rnd(0, h), 1, 1);
  }
  ctx.restore();
}

/** Vertical gradient fill of a rect, for the subtle gradients the style uses on big flats. */
export function vgrad(ctx: Ctx, x: number, y: number, w: number, h: number, top: string, bottom: string) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

/** Round-capped stroke, the only kind of line the style uses. */
export function line(ctx: Ctx, pts: number[], color: string, w: number) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.stroke();
  ctx.restore();
}
