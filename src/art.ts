import Phaser from "phaser";
import { CARTOUCHES, RES, STAT_BAR, TILE, VIEW_H, VIEW_W } from "./config";
import {
  PAL, TAU, castShadow, circleP, ellipseP, eye, fill, grain, line, lit, lightOf, mix, polyP, puffP, rgba, rnd,
  rrectP, shadeOf, starP, unionP, vgrad, type Ctx, type PathFn,
} from "./style";

// Egyptian theme art in a flat Kurzgesagt-like style, drawn in code at boot (no image files).
// Light comes from the top-left everywhere; shadows are soft indigo.
// Every texture here is cosmetic; gameplay only refers to them by key.

function canvas(scene: Phaser.Scene, key: string, w: number, h: number, paint: (ctx: Ctx) => void) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h)!;
  paint(tex.getContext());
  tex.refresh();
}

const STONE = "#f7cf8e", GOLD = PAL.yellow;

// ---------------------------------------------------------------- ground tiles

export const DESERT_FRAMES = {
  sand: [0, 1, 2, 3],
  paving: [4, 5],
  fertile: [6, 7],
  water: [8, 9],
  bridge: [10],
  wall: [11],
};

/** Soft dune ripple: a light crest over a shaded trough, kept inside the tile so it doesn't seam. */
function ripple(ctx: Ctx, x: number, y: number, w: number, light: string, dark: string) {
  line(ctx, [x, y + 2, x + w * 0.5, y - 1, x + w, y + 2], dark, 3);
  line(ctx, [x, y, x + w * 0.5, y - 3, x + w, y], light, 2);
}

const tilePainters: ((ctx: Ctx) => void)[] = [
  ...[0, 1, 2, 3].map((v) => (ctx: Ctx) => {
    ctx.fillStyle = PAL.sand;
    ctx.fillRect(0, 0, TILE, TILE);
    grain(ctx, TILE, TILE, 140, 0.08, [PAL.sandLight, PAL.sandShade]);
    if (v < 3) for (let i = 0; i < 2; i++) ripple(ctx, rnd(6, 18), rnd(14, 54), rnd(22, 36), rgba(PAL.sandLight, 0.8), rgba(PAL.sandShade, 0.35));
    if (v === 3) { // a little pebble
      const x = rnd(16, 48), y = rnd(16, 48);
      lit(ctx, ellipseP(x, y, 4, 3), "#e3a76a", { sh: 1.5, hi: 1 });
    }
  }),
  ...[0, 1].map((v) => (ctx: Ctx) => {
    ctx.fillStyle = PAL.sandShade;
    ctx.fillRect(0, 0, TILE, TILE);
    for (let row = 0; row < 2; row++) {
      const off = (row + v) % 2 ? 16 : 0;
      for (let col = -1; col < 2; col++) {
        const x = col * 32 + off, y = row * 32, base = mix(PAL.sandLight, PAL.sand, rnd(0, 0.45));
        lit(ctx, rrectP(x + 1.5, y + 1.5, 29, 29, 6), base, { hi: 1.5, sh: 3, shade: mix(base, PAL.sandShade, 0.55) });
      }
    }
  }),
  ...[0, 1].map(() => (ctx: Ctx) => {
    ctx.fillStyle = PAL.green;
    ctx.fillRect(0, 0, TILE, TILE);
    grain(ctx, TILE, TILE, 120, 0.1, [PAL.greenLight, PAL.greenDark]);
    for (let i = 0; i < 9; i++) { // little rounded tufts
      const x = rnd(8, 56), y = rnd(8, 56);
      fill(ctx, unionP(circleP(x - 3, y, 3), circleP(x + 3, y, 3), circleP(x, y - 3, 3.5)), i % 3 ? PAL.greenDark : PAL.greenLight);
    }
  }),
  ...[0, 1].map(() => (ctx: Ctx) => {
    vgrad(ctx, 0, 0, TILE, TILE, PAL.teal, mix(PAL.teal, PAL.lapis, 0.12));
    for (let i = 0; i < 3; i++) {
      const y = rnd(10, 54), x = rnd(6, 24), w = rnd(18, 32);
      line(ctx, [x, y, x + w * 0.25, y - 2.5, x + w * 0.5, y, x + w * 0.75, y + 2.5, x + w, y], rgba("#bff6ee", 0.55), 2.2);
    }
    grain(ctx, TILE, TILE, 60, 0.12, ["#ffffff"]);
  }),
  (ctx: Ctx) => {
    ctx.fillStyle = PAL.woodDark;
    ctx.fillRect(0, 0, TILE, TILE);
    for (let y = 0; y < TILE; y += 8) {
      const base = mix(PAL.wood, PAL.woodLight, rnd(0, 0.35));
      lit(ctx, rrectP(5, y + 1, TILE - 10, 6, 3), base, { hi: 1, sh: 1.5 });
      fill(ctx, circleP(9, y + 4, 1.1), PAL.woodDark);
      fill(ctx, circleP(TILE - 9, y + 4, 1.1), PAL.woodDark);
    }
    ctx.fillStyle = shadeOf(PAL.woodDark, 0.25);
    ctx.fillRect(0, 0, 4, TILE);
    ctx.fillRect(TILE - 4, 0, 4, TILE);
  },
  (ctx: Ctx) => {
    // sandstone blocks
    ctx.fillStyle = mix(PAL.sandShade, PAL.violet, 0.35);
    ctx.fillRect(0, 0, TILE, TILE);
    for (let row = 0; row < 3; row++) {
      const h = row === 2 ? 20 : 22, y = row * 22, off = row % 2 ? 0 : -16;
      for (let x = off; x < TILE; x += 32) {
        const base = mix(STONE, PAL.sand, rnd(0, 0.6));
        lit(ctx, rrectP(x + 1.5, y + 1.5, 29, h - 3, 4), base, { hi: 2, sh: 4, shade: mix(base, PAL.sandShade, 0.6) });
      }
    }
  },
];

/** Tileset with every tile's edge pixels repeated outwards (margin 1, spacing 2), like tiles_extruded. */
function makeDesertTileset(scene: Phaser.Scene) {
  const cell = TILE + 2;
  const tex = scene.textures.createCanvas("desert", tilePainters.length * cell, cell)!;
  const ctx = tex.getContext();
  tilePainters.forEach((paint, i) => {
    const src = document.createElement("canvas");
    src.width = src.height = TILE;
    paint(src.getContext("2d")!);
    const dx = i * cell + 1, dy = 1;
    ctx.drawImage(src, dx, dy);
    ctx.drawImage(src, 0, 0, TILE, 1, dx, dy - 1, TILE, 1);
    ctx.drawImage(src, 0, TILE - 1, TILE, 1, dx, dy + TILE, TILE, 1);
    ctx.drawImage(src, 0, 0, 1, TILE, dx - 1, dy, 1, TILE);
    ctx.drawImage(src, TILE - 1, 0, 1, TILE, dx + TILE, dy, 1, TILE);
  });
  tex.refresh();
}

// ---------------------------------------------------------------- landmarks

/** Four-faced pyramid seen from above, lit from the top-left: top and left faces bright, the others in shade. */
function pyramidFaces(ctx: Ctx, x0: number, y0: number, s: number, colors: string[]) {
  const x1 = x0 + s, y1 = y0 + s, cx = x0 + s / 2, cy = y0 + s / 2;
  fill(ctx, polyP([x0, y0, x1, y0, cx, cy]), colors[0]); // top
  fill(ctx, polyP([x0, y0, x0, y1, cx, cy]), colors[1]); // left
  fill(ctx, polyP([x1, y0, x1, y1, cx, cy]), colors[2]); // right
  fill(ctx, polyP([x0, y1, x1, y1, cx, cy]), colors[3]); // bottom
}

const STONE_FACES = [PAL.sandLight, PAL.sand, PAL.sandShade, mix(PAL.sandShade, PAL.violet, 0.45)];
const GOLD_FACES = ["#fff1a8", PAL.yellow, PAL.orange, mix(PAL.orange, PAL.pink, 0.5)];

function makePyramid(scene: Phaser.Scene) {
  const S = TILE * 3;
  canvas(scene, "pyramid", S, S, (ctx) => {
    const m = 4, s = S - 2 * m, c = S / 2;
    pyramidFaces(ctx, m, m, s, STONE_FACES);
    // stone courses: soft bands on each face
    ctx.save();
    for (let k = 14; k < s / 2 - 16; k += 14) {
      ctx.strokeStyle = rgba(PAL.indigo, 0.08); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(m + k, m + k, s - 2 * k, s - 2 * k, 2); ctx.stroke();
    }
    ctx.restore();
    // a lit ridge on the top-left edges
    line(ctx, [m + 2, m + 2, c, c], rgba("#ffffff", 0.5), 2.5);
    // gilded capstone with a little glint
    pyramidFaces(ctx, c - 15, c - 15, 30, GOLD_FACES);
    fill(ctx, starP(c - 6, c - 6, 6, 1.5, 4, 0), rgba("#ffffff", 0.9));
  });
}

function makeObelisk(scene: Phaser.Scene) {
  canvas(scene, "obelisk", TILE, TILE, (ctx) => {
    lit(ctx, rrectP(5, 5, 54, 54, 8), mix(PAL.sandShade, PAL.violet, 0.2), { hi: 2, sh: 4 });
    castShadow(ctx, rrectP(12, 12, 40, 40, 2), 6, 6, 0.4);
    pyramidFaces(ctx, 12, 12, 40, STONE_FACES);
    pyramidFaces(ctx, 23, 23, 18, GOLD_FACES);
  });
}

function makeColumn(scene: Phaser.Scene) {
  canvas(scene, "column", TILE, TILE, (ctx) => {
    const c = TILE / 2;
    castShadow(ctx, circleP(c, c, 25), 5, 5, 0.4);
    lit(ctx, circleP(c, c, 27), STONE, { hi: 2.5, sh: 5, shade: PAL.sandShade });
    // lotus capital: petals in teal and pink
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      lit(ctx, ellipseP(c + Math.cos(a) * 18, c + Math.sin(a) * 18, 6.5, 3.8, a), i % 2 ? PAL.teal : PAL.pink, { hi: 1, sh: 1.5 });
    }
    lit(ctx, circleP(c, c, 11), PAL.sandLight, { hi: 1.5, sh: 2.5 });
    lit(ctx, circleP(c, c, 5), GOLD, { hi: 1, sh: 1.5 });
  });
}

function pedestal(ctx: Ctx) {
  lit(ctx, rrectP(4, 4, 56, 56, 9), mix(PAL.sandShade, PAL.violet, 0.15), { hi: 2, sh: 4 });
  lit(ctx, rrectP(9, 9, 46, 46, 6), PAL.sand, { hi: 1.5, sh: 2.5 });
}

/** Anubis as a recumbent jackal in profile on a plinth: deep indigo with gold, a cute amber eye. */
function makeAnubis(scene: Phaser.Scene) {
  canvas(scene, "anubis", TILE, TILE, (ctx) => {
    pedestal(ctx);
    const body = unionP(
      ellipseP(28, 42, 16, 8), ellipseP(17, 44, 7, 8), rrectP(34, 46, 21, 6, 3),
      polyP([36, 38, 42, 22, 49, 26, 47, 42]), circleP(46, 24, 6), polyP([49, 20, 60, 25, 49, 29]),
      polyP([40, 21, 41, 6, 47, 19]), polyP([45, 19, 49, 7, 51, 21]),
    );
    castShadow(ctx, body, 4, 4, 0.45);
    lit(ctx, body, PAL.violet, { light: PAL.lilac, shade: PAL.night, hi: 1.5, sh: 2.5 });
    line(ctx, [13, 42, 7, 46, 9, 52], PAL.violet, 3.5); // tail
    line(ctx, [40, 31, 48, 34], GOLD, 3); // collar
    eye(ctx, 47.5, 23, 2.2, 1, 0, PAL.yellow);
  });
}

/** Bastet: a seated cat in profile with gold jewellery and a big green eye, on a plinth. */
function makeBastet(scene: Phaser.Scene) {
  canvas(scene, "bastet", TILE, TILE, (ctx) => {
    pedestal(ctx);
    const body: PathFn = (c) => {
      c.moveTo(18, 55); c.quadraticCurveTo(14, 30, 31, 25); c.lineTo(41, 26); c.quadraticCurveTo(46, 40, 45, 55); c.closePath();
    };
    const all = unionP(body, circleP(37, 19, 7.5), polyP([30.5, 17, 31.5, 4, 38, 13]), polyP([37, 13, 43.5, 4, 45, 17]), ellipseP(44, 21, 4, 3.5));
    castShadow(ctx, all, 4, 4, 0.45);
    line(ctx, [20, 54, 10, 54, 12, 44], PAL.violet, 4.5); // tail round the feet
    lit(ctx, all, PAL.violet, { light: PAL.lilac, shade: PAL.night, hi: 1.5, sh: 2.5 });
    fill(ctx, polyP([32.5, 15, 33, 8, 36.5, 13]), PAL.pink); // inner ear
    line(ctx, [31, 27, 37, 31, 42, 27], GOLD, 3); // necklace
    fill(ctx, circleP(33, 22.5, 2), GOLD); // earring
    eye(ctx, 40.5, 18, 2.6, 1, 0, PAL.greenLight);
  });
}

/** A live cat seen from above, facing right (+x). Drawn pale (white with soft lilac shade) so tints read. */
function makeCat(scene: Phaser.Scene) {
  canvas(scene, "cat", 40, 32, (ctx) => {
    line(ctx, [9, 16, 3, 14, 4, 7], "#e4e2ee", 3.5); // tail
    const body = unionP(ellipseP(17, 16, 10.5, 6.5), circleP(29, 16, 6.2), polyP([26, 12, 31.5, 7, 32, 13]), polyP([26, 20, 31.5, 25, 32, 19]));
    lit(ctx, body, "#ffffff", { light: "#ffffff", shade: "#d9d6e8", hi: 0, sh: 2.2 });
    ctx.save(); ctx.globalAlpha = 0.18; // soft tabby stripes
    for (const x of [12, 16.5, 21]) line(ctx, [x, 11, x + 1, 21], PAL.indigo, 2);
    ctx.restore();
    fill(ctx, circleP(33, 13.2, 1.5), PAL.night); // eyes on the face
    fill(ctx, circleP(33, 18.8, 1.5), PAL.night);
    fill(ctx, circleP(35, 16, 1), "#ffb3c2"); // nose
  });
}

/** Palm crown: rounded fronds in two greens with a shaded side, dates at the heart. */
function makePalm(scene: Phaser.Scene) {
  const S = 120, c = S / 2;
  canvas(scene, "palm", S, S, (ctx) => {
    const fronds = 9;
    const frond = (len: number, bend: number): PathFn => (p) => {
      p.moveTo(0, 0);
      p.quadraticCurveTo(len * 0.5, -12 + bend * len * 0.5, len, bend * len);
      p.quadraticCurveTo(len * 0.5, 12 + bend * len * 0.5, 0, 0);
    };
    const leaves: { a: number; len: number; bend: number }[] = [];
    for (let i = 0; i < fronds; i++) leaves.push({ a: (i / fronds) * TAU + rnd(-0.15, 0.15), len: rnd(46, 56), bend: rnd(-0.2, 0.2) });
    for (const pass of [0, 1]) {
      leaves.forEach(({ a, len, bend }, i) => {
        if (i % 2 !== pass) return;
        ctx.save(); ctx.translate(c, c); ctx.rotate(a);
        const lightSide = Math.cos(a + Math.PI / 4) < 0; // fronds pointing top-left catch the light
        const base = pass ? PAL.green : PAL.greenDark;
        fill(ctx, frond(len, bend), lightSide ? lightOf(base, 0.15) : base);
        ctx.save(); ctx.beginPath(); frond(len, bend)(ctx); ctx.clip(); // shaded half below the midrib
        ctx.fillStyle = shadeOf(base, 0.3); ctx.fillRect(0, bend * 4, len + 2, 20);
        ctx.restore();
        ctx.restore();
      });
    }
    lit(ctx, circleP(c, c, 7), PAL.woodDark, { hi: 1, sh: 2 });
    for (let i = 0; i < 6; i++) lit(ctx, circleP(c + rnd(-5, 5), c + rnd(-5, 5), 2.6), PAL.orange, { hi: 0.8, sh: 1 });
  });
}

function makeReeds(scene: Phaser.Scene) {
  canvas(scene, "reeds", 56, 56, (ctx) => {
    const c = 28;
    for (let i = 0; i < 12; i++) {
      const a = rnd(0, TAU), r = rnd(10, 22);
      const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
      line(ctx, [c, c, x, y], PAL.greenDark, 2);
      // papyrus umbel: a little flat starburst
      fill(ctx, starP(x, y, 6, 3, 7, rnd(0, 1)), i % 3 ? PAL.greenLight : PAL.green);
      fill(ctx, circleP(x, y, 1.6), PAL.yellow);
    }
  });
}

/** Explosive oil jar seen from above: a terracotta pot with a pink danger band and a dark mouth. */
function makeJar(scene: Phaser.Scene) {
  canvas(scene, "jar", 48, 48, (ctx) => {
    lit(ctx, circleP(24, 24, 19), "#e2703f", { light: "#ff9f6a", shade: "#a8442f", hi: 2.5, sh: 5 });
    ctx.save(); ctx.lineWidth = 4.5; ctx.strokeStyle = PAL.pink;
    ctx.beginPath(); ctx.arc(24, 24, 13, 0, TAU); ctx.stroke(); ctx.restore();
    lit(ctx, circleP(24, 24, 8.5), "#a8442f", { hi: 0, sh: 2, shade: "#7a2f2a" });
    fill(ctx, circleP(24.5, 24.5, 5), PAL.night);
    fill(ctx, ellipseP(15, 14, 4, 2.2, -0.8), rgba("#ffffff", 0.45)); // glaze glint
  });
}

/** Hieroglyphs laid over sandstone walls: flat filled shapes in a deep violet. */
function makeGlyphs(scene: Phaser.Scene) {
  canvas(scene, "glyphs", TILE, TILE, (ctx) => {
    const ink = rgba(PAL.violet, 0.65);
    // ankh
    ctx.save(); ctx.strokeStyle = ink; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(14, 12, 4, 5, 0, 0, TAU); ctx.stroke(); ctx.restore();
    line(ctx, [14, 17, 14, 30], ink, 2.5); line(ctx, [8, 20, 20, 20], ink, 2.5);
    // eye of Horus
    fill(ctx, ellipseP(44, 13, 8, 4), ink);
    fill(ctx, circleP(44, 13, 2.2), PAL.sandLight);
    line(ctx, [42, 17, 40, 25], ink, 2.5);
    ctx.save(); ctx.strokeStyle = ink; ctx.lineWidth = 2.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(48, 17); ctx.quadraticCurveTo(52, 26, 46, 26); ctx.stroke(); ctx.restore();
    // water
    const w: number[] = [];
    for (let x = 8; x <= 30; x += 4) w.push(x, x % 8 ? 41 : 47);
    line(ctx, w, ink, 2.5);
    // bird
    fill(ctx, ellipseP(44, 47, 7, 4, -0.3), ink);
    fill(ctx, circleP(50, 41, 3), ink);
    line(ctx, [42, 50, 40, 57], ink, 2); line(ctx, [46, 50, 46, 57], ink, 2);
  });
}

function makeStreak(scene: Phaser.Scene) {
  canvas(scene, "streak", 32, 3, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 32, 0);
    g.addColorStop(0, rgba(PAL.sandLight, 0));
    g.addColorStop(0.5, rgba(PAL.ink, 1));
    g.addColorStop(1, rgba(PAL.sandLight, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(0, 0, 32, 3, 1.5); ctx.fill();
  });
}

/** A nemes headdress seen from above: gold with lapis stripes running back from the brow. */
function nemes(ctx: Ctx, x: number, y: number, r: number, stripe = PAL.lapis) {
  const head = circleP(x, y, r);
  lit(ctx, head, GOLD, { light: "#fff1a8", shade: PAL.orange, hi: r * 0.15, sh: r * 0.3 });
  ctx.save(); ctx.beginPath(); head(ctx); ctx.clip();
  ctx.globalAlpha = 0.9;
  for (let k = -2; k <= 2; k++) line(ctx, [x - r * 1.2, y + k * r * 0.42, x + r * 0.35, y + k * r * 0.28], stripe, r * 0.17);
  ctx.restore();
}

/** The boss: a gilded war chariot with the Pharaoh, two plumed horses in front. Faces right (+x). */
function makeChariot(scene: Phaser.Scene) {
  canvas(scene, "chariot", 176, 96, (ctx) => {
    // wheels (seen edge-on from above)
    for (const y of [6, 80]) {
      lit(ctx, rrectP(26, y, 44, 10, 5), PAL.woodDark, { hi: 1, sh: 2 });
      fill(ctx, rrectP(28, y + 3.5, 40, 3, 1.5), GOLD);
    }
    fill(ctx, rrectP(46, 12, 6, 72, 3), PAL.woodDark); // axle
    lit(ctx, rrectP(72, 45, 46, 6, 3), PAL.wood, { hi: 1, sh: 2 }); // pole
    // horses
    for (const y of [28, 68]) {
      line(ctx, [110, y, 101, y + 3], PAL.night, 3); // tail
      const horse = unionP(ellipseP(134, y, 24, 10.5), ellipseP(161, y, 10.5, 6));
      lit(ctx, horse, "#b0603a", { light: "#d98a5a", shade: "#7a3a33", hi: 2, sh: 3.5 });
      lit(ctx, rrectP(121, y - 9.5, 23, 19, 6), PAL.teal, { hi: 1.5, sh: 3 }); // caparison
      fill(ctx, rrectP(121, y - 9.5, 23, 3.5, 1.5), PAL.pink);
      fill(ctx, rrectP(121, y + 6, 23, 3.5, 1.5), PAL.pink);
      line(ctx, [146, y, 156, y], PAL.night, 3.5); // mane
      eye(ctx, 165, y - 4, 1.8, 1, -0.4); eye(ctx, 165, y + 4, 1.8, 1, 0.4);
      // pink ostrich-feather plume
      fill(ctx, unionP(ellipseP(152, y, 7, 5.5)), PAL.pink);
      fill(ctx, ellipseP(150, y - 1, 4, 2.5), lightOf(PAL.pink, 0.3));
      fill(ctx, circleP(158, y, 2.8), GOLD);
    }
    // reins
    ctx.save(); ctx.globalAlpha = 0.85;
    for (const y of [28, 68]) line(ctx, [58, 48, 160, y], PAL.night, 1.3);
    ctx.restore();
    // chariot box: gold with a teal inlay
    castShadow(ctx, rrectP(26, 20, 48, 56, 12), 5, 5, 0.4);
    lit(ctx, rrectP(26, 20, 48, 56, 12), GOLD, { light: "#fff1a8", shade: PAL.orange, hi: 2.5, sh: 5 });
    ctx.save(); ctx.strokeStyle = PAL.teal; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(31.5, 25.5, 37, 45, 8); ctx.stroke(); ctx.restore();
    // the Pharaoh: linen shoulders, arms forward, striped nemes, cute eyes
    lit(ctx, ellipseP(48, 48, 11, 17), PAL.linen, { light: "#ffffff", shade: PAL.linenShade, hi: 1, sh: 3 });
    fill(ctx, rrectP(53, 37, 13, 5, 2.5), "#d98a5a");
    fill(ctx, rrectP(53, 54, 13, 5, 2.5), "#d98a5a");
    nemes(ctx, 48, 48, 12);
    eye(ctx, 56, 45, 2.2); eye(ctx, 56, 51, 2.2);
    fill(ctx, circleP(59.5, 48, 2.2), PAL.pink); // uraeus
  });
}

/** Flat-topped acacia: an umbrella of rounded olive puffs, lit top-left, shade bottom-right. */
function makeAcacia(scene: Phaser.Scene) {
  const S = 128, c = S / 2;
  canvas(scene, "acacia", S, S, (ctx) => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + rnd(-0.3, 0.3);
      line(ctx, [c, c, c + Math.cos(a) * 52, c + Math.sin(a) * 52], PAL.woodDark, 3);
    }
    const blobs: PathFn[] = [];
    for (let i = 0; i < 16; i++) {
      const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * 38;
      blobs.push(circleP(c + Math.cos(a) * r * 1.1, c + Math.sin(a) * r * 0.9, rnd(12, 17)));
    }
    const crown = unionP(...blobs);
    lit(ctx, crown, "#8fb83a", { light: "#c4dc5a", shade: "#4f8a3a", hi: 4, sh: 9 });
    for (let i = 0; i < 8; i++) fill(ctx, circleP(c + rnd(-34, 30), c + rnd(-34, 30), rnd(2.5, 4)), rgba("#e8f59a", 0.6));
  });
}

/** Dry desert shrub (tamarisk): a few twigs tipped with soft sage puffs. */
function makeShrub(scene: Phaser.Scene) {
  canvas(scene, "shrub", 40, 40, (ctx) => {
    const tips: PathFn[] = [];
    for (let i = 0; i < 9; i++) {
      const a = rnd(0, TAU), r = rnd(8, 15), x = 20 + Math.cos(a) * r, y = 20 + Math.sin(a) * r;
      line(ctx, [20, 20, x, y], PAL.woodDark, 1.6);
      tips.push(circleP(x, y, rnd(3, 4.5)));
    }
    lit(ctx, unionP(...tips), "#b5b86a", { light: "#d9da8e", shade: "#82884a", hi: 1, sh: 1.8 });
  });
}

/** Cut limestone blocks (replace the sandbags). */
function makeBlocks(scene: Phaser.Scene) {
  canvas(scene, "blocks", 64, 44, (ctx) => {
    const block = (x: number, y: number, w: number, h: number) => {
      const base = mix(PAL.sandLight, STONE, rnd(0, 0.6));
      lit(ctx, rrectP(x, y, w, h, 5), base, { hi: 2, sh: 4, shade: mix(base, PAL.sandShade, 0.6) });
    };
    block(2, 4, 30, 20); block(33, 2, 29, 22); block(10, 23, 44, 19);
  });
}

function makeLotus(scene: Phaser.Scene) {
  canvas(scene, "lotus_pad", 32, 32, (ctx) => {
    const pad: PathFn = (c) => { c.moveTo(16, 16); c.arc(16, 16, 13, 0.35, TAU - 0.05); c.closePath(); };
    lit(ctx, pad, PAL.green, { hi: 1.5, sh: 2.5 });
    ctx.save(); ctx.globalAlpha = 0.35;
    for (let i = 0; i < 5; i++) { const a = 0.9 + i * 1.05; line(ctx, [16, 16, 16 + Math.cos(a) * 10, 16 + Math.sin(a) * 10], PAL.greenDark, 1.2); }
    ctx.restore();
  });
  canvas(scene, "lotus_flower", 24, 24, (ctx) => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      fill(ctx, ellipseP(12 + Math.cos(a) * 6, 12 + Math.sin(a) * 6, 5.2, 2.8, a), i % 2 ? PAL.pink : "#ffd0dc");
    }
    lit(ctx, circleP(12, 12, 3.4), PAL.yellow, { hi: 0.8, sh: 1 });
  });
}

/** Nile crocodile, top-down, facing right: rounded teal-green body, bumpy back, sleepy cute eyes. */
function makeCrocodile(scene: Phaser.Scene) {
  canvas(scene, "croc", 112, 36, (ctx) => {
    const tail: PathFn = (c) => { c.moveTo(2, 18); c.quadraticCurveTo(20, 11.5, 42, 11.5); c.lineTo(42, 24.5); c.quadraticCurveTo(20, 24.5, 2, 18); c.closePath(); };
    const legs = [[44, 6], [44, 30], [66, 7], [66, 29]].map(([x, y]) => ellipseP(x, y, 5.5, 3.2, 0.5));
    const body = unionP(tail, ellipseP(56, 18, 20, 9.5), rrectP(70, 12, 39, 12, 6), ...legs);
    lit(ctx, body, "#4fa36a", { light: "#7cc884", shade: "#2c6e5a", hi: 1.5, sh: 3 });
    for (let x = 16; x < 72; x += 7) fill(ctx, rrectP(x, 15.5, 4, 5, 2), "#3c8a5e"); // scutes
    for (const y of [13.5, 22.5]) { // bulging eyes on top of the head
      fill(ctx, circleP(80, y, 3.4), "#4fa36a");
      eye(ctx, 80.5, y, 2.4, 1, 0, PAL.yellow);
    }
    fill(ctx, circleP(105, 15.5, 0.9), PAL.night); fill(ctx, circleP(105, 20.5, 0.9), PAL.night); // nostrils
  });
}

/** Felucca: a Nile sailing boat with a big lateen sail, facing right. */
function makeFelucca(scene: Phaser.Scene) {
  canvas(scene, "felucca", 128, 72, (ctx) => {
    const hull: PathFn = (c) => { c.moveTo(10, 36); c.quadraticCurveTo(30, 18, 100, 26); c.lineTo(122, 36); c.lineTo(100, 46); c.quadraticCurveTo(30, 54, 10, 36); c.closePath(); };
    lit(ctx, hull, PAL.woodDark, { light: PAL.wood, hi: 2, sh: 3 });
    const deck: PathFn = (c) => { c.moveTo(18, 36); c.quadraticCurveTo(34, 24, 98, 30); c.lineTo(112, 36); c.lineTo(98, 42); c.quadraticCurveTo(34, 48, 18, 36); c.closePath(); };
    fill(ctx, deck, PAL.woodLight);
    // the sail, swung out over the water: white linen with a pink stripe
    const sail = polyP([30, 34, 104, 2, 70, 40]);
    castShadow(ctx, sail, 6, 8, 0.3);
    lit(ctx, sail, PAL.ink, { light: "#ffffff", shade: PAL.linenShade, hi: 1, sh: 4 });
    ctx.save(); ctx.beginPath(); sail(ctx); ctx.clip(); line(ctx, [40, 34, 102, 6], PAL.pink, 4); ctx.restore();
    line(ctx, [26, 36, 106, 0], PAL.woodDark, 2.5);
    fill(ctx, circleP(66, 36, 3), PAL.night); // mast
    lit(ctx, circleP(28, 38, 5), PAL.teal, { hi: 1, sh: 1.5 }); // boatman
  });
}

/**
 * Soft blend from one ground into another: the actual ground tile (so the colour and texture match
 * exactly), opaque at the bottom and thinning out upwards in irregular clumps.
 */
function makeFade(scene: Phaser.Scene, key: string, h: number, paint: (ctx: Ctx) => void) {
  canvas(scene, key, TILE, h, (ctx) => {
    for (let y = 0; y < h; y += TILE) {
      const tile = document.createElement("canvas");
      tile.width = tile.height = TILE;
      paint(tile.getContext("2d")!);
      ctx.drawImage(tile, 0, y);
    }
    // alpha mask: solid at the bottom, then rounded scallops of shrinking clumps (flat, no blur)
    const mask = document.createElement("canvas");
    mask.width = TILE; mask.height = h;
    const m = mask.getContext("2d")!;
    m.fillStyle = "#000";
    m.fillRect(0, h * 0.55, TILE, h * 0.45);
    for (let i = 0; i < h * 2; i++) {
      const t = Math.pow(Math.random(), 0.7), y = h * (0.15 + 0.85 * t);
      const r = 2 + 9 * t;
      m.beginPath(); m.arc(rnd(0, TILE), y, r, 0, TAU); m.fill();
    }
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  });
}

/**
 * A mummy seen from above, facing right (+x): soft linen body with wrapped bands, arms out in
 * front, big glowing eyes. The priest wears a striped headdress and a gold collar.
 */
function makeMummy(scene: Phaser.Scene, key: string, priest: boolean) {
  canvas(scene, key, 52, 44, (ctx) => {
    const linen = priest ? "#ece4d0" : PAL.linen, shade = PAL.linenShade;
    const bands = (path: PathFn, n: number, x0: number, x1: number, y0: number, y1: number, tilt: number) => {
      ctx.save(); ctx.beginPath(); path(ctx); ctx.clip(); ctx.globalAlpha = 0.45;
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, y = y0 + (y1 - y0) * t; line(ctx, [x0, y, x1, y + tilt], shade, 1.6); }
      ctx.restore();
    };
    // a loose bandage trailing behind
    line(ctx, [9, 30, 2, 34, 4, 42], shade, 3);
    // outstretched arms
    for (const y of [10, 30]) {
      const arm = rrectP(18, y, 30, 7.5, 3.75);
      lit(ctx, arm, linen, { light: "#ffffff", shade, hi: 1, sh: 2 });
      ctx.save(); ctx.beginPath(); arm(ctx); ctx.clip(); ctx.globalAlpha = 0.5;
      for (let x = 24; x < 46; x += 5) line(ctx, [x, y, x + 3, y + 8], shade, 1.3);
      ctx.restore();
    }
    // shoulders
    const torso = ellipseP(18, 22, 11.5, 17);
    lit(ctx, torso, linen, { light: "#ffffff", shade, hi: 1.5, sh: 4 });
    bands(torso, 7, 6, 30, 6, 38, 3);
    if (priest) { ctx.save(); ctx.strokeStyle = GOLD; ctx.lineWidth = 3.5; ctx.lineCap = "round"; ctx.beginPath(); ctx.arc(22, 22, 10.5, -1.2, 1.2); ctx.stroke(); ctx.restore(); }
    // head
    if (priest) nemes(ctx, 23, 22, 10, PAL.teal);
    else {
      const head = circleP(23, 22, 9);
      lit(ctx, head, "#fbf7ee", { light: "#ffffff", shade, hi: 1, sh: 2.5 });
      bands(head, 5, 13, 33, 14, 30, -2);
    }
    // big glowing eyes, peeking out between the wraps
    for (const y of [18, 26]) {
      fill(ctx, circleP(29.5, y, 3.6), rgba("#b8ff7a", 0.35));
      eye(ctx, 29.5, y, 2.6, 1, 0, "#b8ff7a", "#1f6b3a");
    }
  });
}

/**
 * The player: a young pharaoh seen from above, facing right (+x). Striped nemes headdress,
 * broad gold-and-teal collar, a golden sun-staff held forward on the right (it fires),
 * the crook in the left hand, and a pair of big eyes looking where he aims.
 */
function makePharaoh(scene: Phaser.Scene) {
  canvas(scene, "pharaoh", 54, 44, (ctx) => {
    // sun-staff (right hand, below the aim axis) and crook (left hand)
    line(ctx, [22, 32, 49, 32], PAL.orange, 4);
    line(ctx, [22, 31.3, 49, 31.3], PAL.yellow, 1.6);
    fill(ctx, starP(50, 32, 5.5, 3, 8, 0.2), PAL.orange); // sun disk
    lit(ctx, circleP(50, 32, 3.4), PAL.yellow, { hi: 0.8, sh: 1.2, light: "#fff6c0" });
    ctx.save(); ctx.strokeStyle = PAL.lapis; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(22, 11); ctx.lineTo(36, 11); ctx.arc(36, 8, 3, Math.PI / 2, -Math.PI / 2, true); ctx.stroke(); ctx.restore();
    // arms
    const skin = "#d98a5a";
    lit(ctx, rrectP(15, 28, 11, 7, 3.5), skin, { hi: 1, sh: 1.5 });
    lit(ctx, rrectP(15, 8, 11, 7, 3.5), skin, { hi: 1, sh: 1.5 });
    // white linen shoulders
    lit(ctx, ellipseP(17, 22, 10.5, 16), PAL.linen, { light: "#ffffff", shade: PAL.linenShade, hi: 1.5, sh: 3.5 });
    // broad collar (usekh): rings of gold, teal and pink
    for (const [r, c] of [[13.5, PAL.yellow], [11.3, PAL.teal], [9.3, PAL.orange], [7.6, PAL.pink]] as const) {
      fill(ctx, (p) => { p.moveTo(19, 22 - r); p.arc(19, 22, r, -Math.PI / 2, Math.PI / 2, true); p.closePath(); }, c);
    }
    // nemes lappets falling forward over the shoulders
    for (const y of [12, 32]) {
      lit(ctx, rrectP(21, y - 3.5, 9, 7, 3), PAL.yellow, { hi: 0.8, sh: 1.5, shade: PAL.orange });
      fill(ctx, rrectP(24, y - 3.5, 2, 7, 1), PAL.lapis);
    }
    nemes(ctx, 22, 22, 10.5);
    eye(ctx, 29, 18.5, 2.7); eye(ctx, 29, 25.5, 2.7);
    // gold cobra (uraeus) on the brow
    lit(ctx, ellipseP(32.5, 22, 2.6, 1.9), PAL.yellow, { hi: 0.6, sh: 0.8, shade: PAL.orange });
    fill(ctx, circleP(33.5, 22, 0.9), PAL.pink);
  });
}

/** Light rays fanning out from a point, for glowing effects (drawn with additive blending): flat wedges. */
function makeSunrays(scene: Phaser.Scene) {
  const S = 256, c = S / 2;
  canvas(scene, "sunrays", S, S, (ctx) => {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + rnd(-0.08, 0.08), w = rnd(0.05, 0.1), len = rnd(0.7, 1) * c;
      const g = ctx.createRadialGradient(c, c, 0, c, c, len);
      g.addColorStop(0, rgba("#fff1c0", 0.9));
      g.addColorStop(0.7, rgba(PAL.yellow, 0.45));
      g.addColorStop(1, rgba(PAL.orange, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, len, a - w, a + w); ctx.closePath(); ctx.fill();
    }
  });
}

/** Spiral bands of a dust devil, spun at the heart of the sandstorm: flat swirling ribbons in sand tones. */
function makeVortex(scene: Phaser.Scene) {
  const S = 256, c = S / 2;
  canvas(scene, "vortex", S, S, (ctx) => {
    const tones = [PAL.sandShade, PAL.sand, PAL.sandLight, PAL.orange, PAL.sand];
    for (let arm = 0; arm < 5; arm++) {
      const a0 = (arm / 5) * TAU;
      // a ribbon: outer edge and inner edge of a spiral, widening outwards
      ctx.beginPath();
      const steps = 60, pts: [number, number][] = [];
      for (let i = 0; i <= steps; i++) {
        const t = 0.06 + (i / steps) * 0.9, a = a0 + t * Math.PI * 2.6, r = t * (c - 6);
        pts.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
      }
      for (let i = steps; i >= 0; i--) {
        const t = 0.06 + (i / steps) * 0.9, a = a0 + t * Math.PI * 2.6 - (0.05 + 0.32 * t), r = t * (c - 6) * 0.94;
        pts.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
      }
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, rgba(tones[arm], 1));
      g.addColorStop(0.8, rgba(tones[arm], 0.9));
      g.addColorStop(1, rgba(tones[arm], 0.1));
      ctx.fillStyle = g;
      ctx.fill();
    }
    // bright little flecks riding the bands
    for (let i = 0; i < 40; i++) {
      const t = rnd(0.1, 0.9), a = rnd(0, TAU);
      fill(ctx, circleP(c + Math.cos(a) * t * c, c + Math.sin(a) * t * c, 1 + 2 * t), rgba(PAL.ink, 0.7 * (1 - t)));
    }
  });
}


/** A stat pill: a flat darker inset with a gold knot bar just inside its right end (where cartouches close). */
function cartouche(ctx: Ctx, x: number, y: number, w: number, h: number) {
  fill(ctx, rrectP(x, y + 1.5, w, h, h / 2), rgba("#000000", 0.25)); // tucked-in shadow
  fill(ctx, rrectP(x, y, w, h, h / 2), PAL.night);
  fill(ctx, rrectP(x + 3, y + 2, w - 6, h * 0.35, h * 0.2), rgba(PAL.lilac, 0.12)); // soft top sheen
  fill(ctx, rrectP(x + w - h / 2 + 0.5, y + 6, 3, h - 12, 1.5), GOLD);
}

/** The HUD's floating stat pills (no frame: the game fills the screen), drawn at full resolution. */
function makeFrame(scene: Phaser.Scene) {
  canvas(scene, "tomb_frame", Math.round(VIEW_W * RES), Math.round(VIEW_H * RES), (ctx) => {
    ctx.scale(RES, RES);
    for (const [x, w] of Object.values(CARTOUCHES)) {
      fill(ctx, rrectP(x + 2, STAT_BAR.y + 4, w, STAT_BAR.h, STAT_BAR.h / 2), rgba(PAL.night, 0.35)); // soft drop shadow on the sand
      cartouche(ctx, x, STAT_BAR.y, w, STAT_BAR.h);
    }
  });
}

/** Saguaro cactus from above: a rounded ribbed crown with a few arms, and a prickly-pear variant. */
function makeCacti(scene: Phaser.Scene) {
  const ribbed = (ctx: Ctx, x: number, y: number, r: number) => {
    lit(ctx, circleP(x, y, r), PAL.green, { light: PAL.greenLight, shade: PAL.greenDark, hi: r * 0.15, sh: r * 0.3 });
    ctx.save(); ctx.globalAlpha = 0.3;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      line(ctx, [x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3, x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85], PAL.greenDark, 1.2);
    }
    ctx.restore();
    for (let i = 0; i < 8; i++) { const a = rnd(0, TAU), rr = rnd(0.35, 0.9) * r; fill(ctx, circleP(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 0.8), PAL.ink); }
  };
  canvas(scene, "cactus", 96, 96, (ctx) => {
    const arms = Phaser.Math.Between(2, 3);
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * TAU + rnd(-0.4, 0.4), len = rnd(22, 34);
      line(ctx, [48, 48, 48 + Math.cos(a) * len, 48 + Math.sin(a) * len], PAL.greenDark, 10);
      ribbed(ctx, 48 + Math.cos(a) * len, 48 + Math.sin(a) * len, 8);
    }
    ribbed(ctx, 48, 48, 16);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; fill(ctx, circleP(48 + Math.cos(a) * 3, 48 + Math.sin(a) * 3, 2.4), PAL.pink); }
    fill(ctx, circleP(48, 48, 1.8), PAL.yellow);
  });
  canvas(scene, "pricklypear", 80, 80, (ctx) => {
    for (let i = 0; i < 6; i++) {
      const a = rnd(0, TAU), r = i === 0 ? 0 : rnd(10, 24);
      const x = 40 + Math.cos(a) * r, y = 40 + Math.sin(a) * r;
      lit(ctx, ellipseP(x, y, 13, 9, a), i % 2 ? PAL.green : mix(PAL.green, PAL.greenLight, 0.3), { shade: PAL.greenDark, hi: 1.5, sh: 3 });
      for (let k = 0; k < 5; k++) fill(ctx, circleP(x + rnd(-7, 7), y + rnd(-4, 4), 0.8), PAL.ink);
      if (Math.random() < 0.5) lit(ctx, circleP(x + Math.cos(a) * 12, y + Math.sin(a) * 12, 3.2), PAL.pink, { hi: 0.8, sh: 1 });
    }
  });
}

/** Sphinx body seen from above, facing up (-y) like the tank sprite it replaces: lion body, paws forward. */
function makeSphinx(scene: Phaser.Scene) {
  canvas(scene, "sphinx", 72, 96, (ctx) => {
    const stone = PAL.sand, light = PAL.sandLight, shade = PAL.sandShade;
    lit(ctx, ellipseP(57, 78, 4.5, 12, 0.4), shade, { hi: 0, sh: 2 }); // tail curled along the flank
    const paws = unionP(rrectP(15, 2, 13, 36, 6.5), rrectP(44, 2, 13, 36, 6.5));
    lit(ctx, paws, stone, { light, shade, hi: 1.5, sh: 3 });
    for (const x of [19, 23, 48, 52]) line(ctx, [x, 3, x, 7], rgba(PAL.violet, 0.35), 1.6); // toes
    const body = unionP(rrectP(13, 30, 46, 62, 20), ellipseP(18, 74, 8.5, 14.5), ellipseP(54, 74, 8.5, 14.5));
    lit(ctx, body, stone, { light, shade, hi: 2.5, sh: 6 });
    lit(ctx, ellipseP(54, 74, 7, 13), shade, { hi: 0, sh: 2, shade: mix(shade, PAL.violet, 0.3) }); // far haunch in shade
    ctx.save(); ctx.globalAlpha = 0.2;
    for (let y = 44; y < 86; y += 10) line(ctx, [22, y, 50, y + 2], PAL.violet, 2); // stone courses
    ctx.restore();
  });
  // the head turns to track the player; it faces down (+y) at rotation 0, like the turret it replaces
  canvas(scene, "sphinx_head", 48, 48, (ctx) => {
    const hood = rrectP(5, 3, 38, 32, 13);
    lit(ctx, hood, GOLD, { light: "#fff1a8", shade: PAL.orange, hi: 2, sh: 4 });
    ctx.save(); ctx.beginPath(); hood(ctx); ctx.clip();
    for (let k = -2; k <= 2; k++) line(ctx, [24 + k * 8, 0, 24 + k * 12, 40], PAL.lapis, 3);
    ctx.restore();
    lit(ctx, ellipseP(24, 30, 10.5, 12.5), PAL.sand, { light: PAL.sandLight, shade: PAL.sandShade, hi: 1.5, sh: 3 }); // face
    eye(ctx, 19.5, 29, 3, 0, 1); eye(ctx, 28.5, 29, 3, 0, 1);
    fill(ctx, ellipseP(24, 39.5, 4.2, 3.2), PAL.night); // open mouth: it spits cat bombs
    fill(ctx, ellipseP(24, 41, 2.4, 1.4), PAL.pink);
    lit(ctx, circleP(24, 8, 3.2), PAL.pink, { hi: 0.8, sh: 1 }); // uraeus
  });
  canvas(scene, "pawprints", 40, 56, (ctx) => {
    const ink = rgba(PAL.indigo, 0.55);
    for (const [x, y] of [[10, 12], [30, 40]]) {
      fill(ctx, ellipseP(x, y + 4, 6, 5), ink);
      for (let k = -1; k <= 2; k++) fill(ctx, circleP(x - 5 + k * 3.5, y - 4 - (k === 0 || k === 1 ? 2 : 0), 2.1), ink);
    }
  });
}

/** A cat bomb: a round violet cat curled up tight with big eyes, a lit fuse for a tail. */
function makeCatBomb(scene: Phaser.Scene) {
  canvas(scene, "catbomb", 32, 32, (ctx) => {
    const cat = unionP(circleP(16, 18, 11), polyP([7.5, 13, 9, 3, 15, 9]), polyP([17, 9, 23, 3, 24.5, 13]));
    lit(ctx, cat, PAL.violet, { light: PAL.lilac, shade: PAL.night, hi: 1.5, sh: 3 });
    fill(ctx, polyP([10, 10, 10.5, 5.5, 13, 8.5]), PAL.pink);
    eye(ctx, 12, 16.5, 2.8, 0.3, 0.3, PAL.yellow); eye(ctx, 20, 16.5, 2.8, 0.3, 0.3, PAL.yellow);
    line(ctx, [26, 22, 30, 23, 30, 27], PAL.woodLight, 2);
    fill(ctx, starP(30, 28.5, 3.8, 1.6, 5, 0), PAL.orange);
    fill(ctx, circleP(30, 28.5, 1.4), PAL.yellow);
  });
}

/** The pharaoh's shot: a glowing golden ankh. Drawn bright and soft for additive blending. */
function makeAnkhBolt(scene: Phaser.Scene) {
  canvas(scene, "ankh_bolt", 40, 40, (ctx) => {
    const g = ctx.createRadialGradient(20, 20, 0, 20, 20, 20);
    g.addColorStop(0, rgba(PAL.yellow, 0.6));
    g.addColorStop(1, rgba(PAL.orange, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 40, 40);
    const draw = (w: number, color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "round";
      ctx.beginPath(); ctx.ellipse(20, 12, 4.5, 6, 0, 0, TAU); ctx.stroke();
      line(ctx, [20, 18, 20, 33], color, w); line(ctx, [12, 20, 28, 20], color, w);
    };
    draw(5.5, rgba(PAL.orange, 0.85));
    draw(2.4, "#fff6d0");
  });
}

/** The thrown sandstorm bomb: a tied linen sack bulging with sand, a gold cord, sand leaking out. */
function makeSandBomb(scene: Phaser.Scene) {
  canvas(scene, "sandbomb", 32, 32, (ctx) => {
    for (let i = 0; i < 8; i++) fill(ctx, circleP(rnd(5, 27), rnd(25, 30), rnd(0.8, 1.4)), PAL.sand); // spilled sand
    lit(ctx, ellipseP(16, 18, 11, 10), PAL.linen, { light: "#ffffff", shade: PAL.linenShade, hi: 1.5, sh: 3 });
    lit(ctx, polyP([12, 10, 20, 10, 16, 3.5]), PAL.linenShade, { hi: 0, sh: 1 }); // gathered neck and tuft
    line(ctx, [11, 9.5, 21, 9.5], GOLD, 3); // gold cord
    lit(ctx, circleP(19, 19, 3.4), PAL.teal, { hi: 0.8, sh: 1 }); // eye-of-Ra seal
    fill(ctx, circleP(19, 19, 1.4), GOLD);
  });
}

// ---------------------------------------------------------------- replacements for the Kenney sprites

/** A prisoner to rescue, seen from above, facing right: a round little scribe with roped arms and big hopeful eyes. */
function makePow(scene: Phaser.Scene) {
  canvas(scene, "pow", 33, 43, (ctx) => {
    lit(ctx, ellipseP(13, 21.5, 9.5, 15), PAL.teal, { hi: 1.5, sh: 3 }); // tunic shoulders
    fill(ctx, rrectP(15, 9, 9, 25, 4.5), "#d98a5a"); // arms held together in front
    line(ctx, [19, 10, 19, 33], PAL.woodLight, 2.5); // the rope
    line(ctx, [22, 14, 22, 29], PAL.woodLight, 2);
    lit(ctx, circleP(16, 21.5, 7.5), PAL.night, { light: PAL.violet, hi: 1, sh: 0 }); // dark hair
    fill(ctx, ellipseP(21, 21.5, 3.5, 6), "#d98a5a"); // face peeking forward
    eye(ctx, 23, 18.5, 2.3); eye(ctx, 23, 24.5, 2.3);
    lit(ctx, circleP(28.5, 7, 4), PAL.yellow, { hi: 0.8, sh: 1, shade: PAL.orange }); // a "help!" bubble
    fill(ctx, rrectP(28, 4.5, 1.2, 3.5, 0.6), PAL.night); fill(ctx, circleP(28.6, 9.3, 0.7), PAL.night);
  });
}

function makeSandbag(scene: Phaser.Scene) {
  canvas(scene, "sandbag", 66, 44, (ctx) => {
    const bag = (x: number, y: number, w: number, h: number) =>
      lit(ctx, rrectP(x, y, w, h, h / 2), mix(PAL.sandLight, "#e8d2b0", rnd(0, 1)), { shade: PAL.sandShade, hi: 1.5, sh: 3.5 });
    bag(3, 3, 30, 18); bag(34, 3, 29, 18); bag(10, 22, 30, 18); bag(40, 22, 22, 18);
  });
}

/** Enemy shot, pointing up (-y): a cursed bolt with a pale core, drawn light so the green tint reads. */
function makeEnemyBullet(scene: Phaser.Scene) {
  canvas(scene, "bullet_enemy", 12, 26, (ctx) => {
    fill(ctx, ellipseP(6, 13, 5.8, 12.5), rgba("#e8ffd8", 0.45));
    fill(ctx, (p) => { p.moveTo(6, 1.5); p.quadraticCurveTo(10.5, 14, 6, 24); p.quadraticCurveTo(1.5, 14, 6, 1.5); p.closePath(); }, "#f4ffe8");
    fill(ctx, ellipseP(6, 9, 1.6, 4), "#ffffff");
  });
}

function makeScorch(scene: Phaser.Scene) {
  canvas(scene, "scorch", 96, 96, (ctx) => {
    fill(ctx, starP(48, 48, 44, 26, 11, rnd(0, 1), 0.2), rgba(PAL.night, 0.55));
    fill(ctx, puffP(48, 48, 30, 8), rgba(PAL.night, 0.6));
    fill(ctx, circleP(48, 48, 14), rgba(PAL.violet, 0.5));
  });
}

function makeTracks(scene: Phaser.Scene) {
  canvas(scene, "tracks", 74, 104, (ctx) => {
    for (const x of [6, 50]) for (let y = 4; y < 100; y += 10) fill(ctx, rrectP(x, y, 18, 6, 3), rgba(PAL.indigo, 0.4));
  });
}

/** Rounded puff clouds for explosions and smoke: four tones, six shapes each. */
function makeSmoke(scene: Phaser.Scene) {
  const tones: Record<string, [string, string, string]> = {
    orange: [PAL.orange, "#fff1a8", PAL.pink],
    yellow: [PAL.yellow, "#fffbe0", PAL.orange],
    grey: ["#8a84bf", "#b9b4e2", "#5d5794"],
    white: ["#f4f1ea", "#ffffff", "#d4cfe6"],
  };
  for (const [name, [base, light, shade]] of Object.entries(tones)) {
    for (let i = 0; i < 6; i++) {
      const S = 80 + i * 4, c = S / 2;
      canvas(scene, `smoke_${name}${i}`, S, S, (ctx) => {
        const cloud = puffP(c, c, c - 4, 6 + (i % 3), i / 6);
        lit(ctx, cloud, base, { light, shade, hi: 4, sh: 9 });
        fill(ctx, circleP(c - c * 0.3, c - c * 0.3, c * 0.12), rgba("#ffffff", 0.4));
      });
    }
  }
}

function makeCrate(scene: Phaser.Scene) {
  canvas(scene, "crate", 64, 64, (ctx) => {
    lit(ctx, rrectP(4, 4, 56, 56, 9), PAL.wood, { light: PAL.woodLight, shade: PAL.woodDark, hi: 3, sh: 5 });
    for (const y of [20, 36]) fill(ctx, rrectP(9, y, 46, 2.5, 1.2), rgba(PAL.woodDark, 0.5)); // planks
    ctx.save(); ctx.beginPath(); ctx.roundRect(10, 10, 44, 44, 5); ctx.clip();
    line(ctx, [12, 12, 52, 52], PAL.woodDark, 7); line(ctx, [12, 11, 52, 51], PAL.woodLight, 3); // brace
    ctx.restore();
    for (const [x, y] of [[11, 11], [53, 11], [11, 53], [53, 53]]) fill(ctx, circleP(x, y, 2), PAL.yellow); // nails
  });
}

// ---------------------------------------------------------------- small fx textures (used by fx.ts)

function makeFxBits(scene: Phaser.Scene) {
  canvas(scene, "fx_star", 16, 16, (ctx) => fill(ctx, starP(8, 8, 7.5, 2.4, 4, -Math.PI / 2), "#ffffff"));
  canvas(scene, "fx_dot", 8, 8, (ctx) => fill(ctx, circleP(4, 4, 3.6), "#ffffff"));
  canvas(scene, "fx_chip", 16, 16, (ctx) => lit(ctx, rrectP(2, 3, 12, 10, 4), "#ffffff", { light: "#ffffff", shade: "#bdb8d6", hi: 0, sh: 3 }));
  canvas(scene, "fx_burst", 128, 128, (ctx) => {
    fill(ctx, starP(64, 64, 62, 34, 12, 0, 0.12), "#ffffff");
  });
  canvas(scene, "fx_ring", 128, 128, (ctx) => {
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(64, 64, 58, 0, TAU); ctx.stroke();
  });
}

export function makeEgyptArt(scene: Phaser.Scene) {
  makeDesertTileset(scene);
  makePyramid(scene);
  makeObelisk(scene);
  makeColumn(scene);
  makeAnubis(scene);
  makeBastet(scene);
  makeCat(scene);
  makePalm(scene);
  makeReeds(scene);
  makeJar(scene);
  makeGlyphs(scene);
  makeStreak(scene);
  makeChariot(scene);
  makeAcacia(scene);
  makeShrub(scene);
  makeBlocks(scene);
  makeLotus(scene);
  makeCrocodile(scene);
  makeFelucca(scene);
  makeFade(scene, "fade_green", TILE * 2, tilePainters[DESERT_FRAMES.fertile[0]]);
  makeFrame(scene);
  makeMummy(scene, "mummy", false);
  makeMummy(scene, "mummy_priest", true);
  makeVortex(scene);
  makePharaoh(scene);
  makeSunrays(scene);
  makeCacti(scene);
  makeSphinx(scene);
  makeCatBomb(scene);
  makeAnkhBolt(scene);
  makeSandBomb(scene);
  makePow(scene);
  makeSandbag(scene);
  makeEnemyBullet(scene);
  makeScorch(scene);
  makeTracks(scene);
  makeSmoke(scene);
  makeCrate(scene);
  makeFxBits(scene);
}
