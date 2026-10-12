import Phaser from "phaser";
import { FRAME, RES, STAT_BAR, TILE, VIEW_H, VIEW_W } from "../config";
import { Bunker, Tank, type Enemy } from "../entities/enemies";
import { DEPTH } from "../fx";
import type { GameScene } from "../scenes/GameScene";
import { GODS, POWERS, type Decree, type Power, type Prank } from "./catalog";

// The divine powers, played on the LIVE game: every target is looked up by id at the moment it is hit,
// so bolts and portals land where the enemy actually is. Flat Kurzgesagt shapes, drawn in code.
// Gameplay changes go through GameScene's council methods; this file is choreography only.

const C = {
  indigo: 0x1b1f4b, deep: 0x11143a, violet: 0x6c5ce7, purple: 0x3a2d6b, sand: 0xf6c177, sandDark: 0xe9955a, sandLight: 0xf9dcaa,
  teal: 0x2ec4b6, nile: 0x1fb5a8, pink: 0xff5e7e, yellow: 0xffd23f, orange: 0xff9f1c, ink: 0xf4f1ea, white: 0xffffff,
};
const FONT = '"Arial Rounded MT Bold", "Avenir Next", Arial, sans-serif';
const TOP = DEPTH.text + 2;

export type PowerHooks = { reshape(a: Extract<Power, { power: "reshape" }>): Promise<{ ok: boolean; message: string }> };

const tween = (s: Phaser.Scene, cfg: Phaser.Types.Tweens.TweenBuilderConfig) =>
  new Promise<void>((done) => s.tweens.add({ ...cfg, onComplete: (...a) => { (cfg.onComplete as ((...x: unknown[]) => void) | undefined)?.(...a); done(); } }));
const wait = (s: Phaser.Scene, ms: number) => new Promise<void>((done) => s.time.delayedCall(ms, done));
const rnd = Phaser.Math.FloatBetween;
const view = (s: GameScene) => ({ top: s.viewTop, cx: VIEW_W / 2, cy: s.viewTop + VIEW_H / 2, x0: FRAME.side, x1: VIEW_W - FRAME.side });
const alive = (s: GameScene) => s.sys.isActive() || s.sys.isPaused();

// ---------------------------------------------------------------- flat shapes

function starburst(s: GameScene, x: number, y: number, r: number, color: number) {
  const g = s.add.graphics({ x, y }).setDepth(TOP);
  const star = (rad: number, fill: number, points = 10) => {
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < points * 2; i++) {
      const a = (i / (points * 2)) * Math.PI * 2, k = i % 2 ? 0.45 : 1;
      pts.push(new Phaser.Math.Vector2(Math.cos(a) * rad * k, Math.sin(a) * rad * k));
    }
    g.fillStyle(fill, 1).fillPoints(pts, true);
  };
  star(r, color);
  star(r * 0.6, C.yellow);
  star(r * 0.32, C.white);
  g.setScale(0.2).setRotation(rnd(0, 1));
  void tween(s, { targets: g, scale: 1, duration: 160, ease: "Back.easeOut" }).then(() => tween(s, { targets: g, alpha: 0, scale: 1.25, duration: 260 })).then(() => g.destroy());
}

function puff(s: GameScene, x: number, y: number, colors: number[], n = 7, spread = 34) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3), r = rnd(10, 18);
    const c = s.add.circle(x, y, r, colors[i % colors.length]).setDepth(TOP - 1);
    const shade = s.add.circle(x + r * 0.25, y + r * 0.25, r * 0.7, C.indigo, 0.18).setDepth(TOP - 1.1);
    void tween(s, { targets: [c, shade], x: `+=${Math.cos(a) * spread}`, y: `+=${Math.sin(a) * spread - 10}`, scale: 1.4, alpha: 0, duration: rnd(500, 750), ease: "Cubic.easeOut" })
      .then(() => { c.destroy(); shade.destroy(); });
  }
}

function ring(s: GameScene, x: number, y: number, r: number, color: number, width = 6) {
  const c = s.add.circle(x, y, 10).setStrokeStyle(width, color, 1).setDepth(TOP);
  void tween(s, { targets: c, radius: r, alpha: 0, duration: 520, ease: "Cubic.easeOut" }).then(() => c.destroy());
}

function flash(s: GameScene, color = C.white, alpha = 0.35, ms = 160) {
  const { top } = view(s);
  const r = s.add.rectangle(0, top, VIEW_W, VIEW_H, color, alpha).setOrigin(0).setDepth(TOP + 3);
  void tween(s, { targets: r, alpha: 0, duration: ms }).then(() => r.destroy());
}

function say(s: GameScene, x: number, y: number, text: string, color = "#ffffff") {
  const t = s.add.text(x, y, text, { fontFamily: FONT, fontSize: "18px", color, stroke: "#1b1f4b", strokeThickness: 5 }).setOrigin(0.5).setDepth(TOP + 1).setResolution(RES);
  t.setScale(0.4);
  void tween(s, { targets: t, scale: 1, duration: 260, ease: "Back.easeOut" })
    .then(() => tween(s, { targets: t, y: y - 40, alpha: 0, delay: 700, duration: 500 })).then(() => t.destroy());
}

/** "RA · SMITE": a flat pill that drops in at the top of the screen as each power starts. */
async function callout(s: GameScene, power: Power["power"]) {
  const meta = POWERS[power], god = GODS[meta.god];
  const { cx, top } = view(s);
  const label = `${god.name.toUpperCase()}  ·  ${meta.label.toUpperCase()}`;
  const t = s.add.text(0, 0, label, { fontFamily: FONT, fontSize: "20px", color: "#ffffff" }).setOrigin(0.5).setResolution(RES);
  const w = t.width + 48, h = 40;
  const g = s.add.graphics();
  g.fillStyle(C.deep, 0.35).fillRoundedRect(-w / 2 + 4, -h / 2 + 6, w, h, h / 2);
  g.fillStyle(Phaser.Display.Color.HexStringToColor(god.color).color, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  g.fillStyle(C.white, 0.18).fillRoundedRect(-w / 2 + 6, -h / 2 + 4, w - 12, h / 2 - 4, (h - 8) / 4);
  const below = top + STAT_BAR.y + STAT_BAR.h + 34; // just under the floating stat pills
  const box = s.add.container(cx, below - 30, [g, t]).setDepth(TOP + 2).setAlpha(0);
  await tween(s, { targets: box, y: below, alpha: 1, duration: 280, ease: "Back.easeOut" });
  s.time.delayedCall(900, () => void tween(s, { targets: box, alpha: 0, y: box.y - 16, duration: 260 }).then(() => box.destroy()));
}

/** A flat sandstone tomb block (generated once). */
function tombTexture(s: Phaser.Scene) {
  if (s.textures.exists("council_tomb")) return "council_tomb";
  const g = s.make.graphics({}, false), S = 96;
  g.fillStyle(C.indigo, 0.28).fillRoundedRect(10, 14, S - 12, S - 12, 14); // cast shadow
  g.fillStyle(C.sandDark, 1).fillRoundedRect(4, 6, S - 12, S - 10, 14); // front
  g.fillStyle(C.sand, 1).fillRoundedRect(4, 4, S - 12, S - 22, 14); // top face
  g.fillStyle(C.sandLight, 1).fillRoundedRect(10, 8, S - 24, 8, 4); // rim light
  g.fillStyle(C.sandDark, 1).fillRoundedRect(S / 2 - 20, 26, 32, 40, 14); // cartouche
  g.fillStyle(C.sand, 1).fillRoundedRect(S / 2 - 16, 30, 24, 32, 11);
  g.fillStyle(C.indigo, 0.85).fillCircle(S / 2 - 4, 38, 5).fillRect(S / 2 - 6, 42, 4, 16).fillRect(S / 2 - 11, 46, 14, 3); // ankh
  g.generateTexture("council_tomb", S, S);
  g.destroy();
  return "council_tomb";
}

// ---------------------------------------------------------------- targeting: one target at a time, in order

/** Glide the frozen camera so (world) y sits comfortably in view; no move if it already does. */
async function focusOn(s: GameScene, y: number, anchor = 0.5, force = false) {
  const top = s.viewTop, rows = s.worldSnapshot().rows;
  const comfy = y > top + VIEW_H * 0.22 && y < top + VIEW_H * 0.78;
  if (comfy && anchor === 0.5 && !force) return;
  const target = Phaser.Math.Clamp(y - VIEW_H * anchor, 0, rows * TILE - VIEW_H);
  const d = Math.abs(target - top);
  if (d < 8) return;
  const cam = { top };
  await tween(s, { targets: cam, top: target, duration: Phaser.Math.Clamp(d * 0.7, 280, 950), ease: "Sine.easeInOut", onUpdate: () => (s.viewTop = cam.top) });
}

/** Numbered badges over every target, so the order shows before anything happens. */
function markTargets(s: GameScene, ids: number[], color: number) {
  const badges = new Map<number, Phaser.GameObjects.Container>();
  ids.forEach((id, i) => {
    const e = s.enemyById(id);
    if (!e) return;
    const g = s.add.graphics();
    g.fillStyle(C.indigo, 0.35).fillCircle(2, 3, 15).fillStyle(color, 1).fillCircle(0, 0, 15).lineStyle(3, C.white, 1).strokeCircle(0, 0, 15);
    const t = s.add.text(0, 0, String(i + 1), { fontFamily: FONT, fontSize: "17px", color: "#ffffff" }).setOrigin(0.5).setResolution(RES);
    const b = s.add.container(e.x, e.y - Math.max(30, e.displayHeight * 0.55) - 14, [g, t]).setDepth(TOP).setScale(0);
    s.tweens.add({ targets: b, scale: 1, duration: 260, delay: i * 70, ease: "Back.easeOut" });
    s.tweens.add({ targets: b, y: b.y - 5, duration: 500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    badges.set(id, b);
  });
  return badges;
}

function dropBadge(s: GameScene, b?: Phaser.GameObjects.Container) {
  if (!b) return;
  s.tweens.killTweensOf(b);
  void tween(s, { targets: b, scale: 0, duration: 180, ease: "Back.easeIn" }).then(() => b.destroy());
}

/** A reticle closes in on the target: the beat before the strike. */
async function lockOn(s: GameScene, e: { x: number; y: number; displayWidth: number }, color: number) {
  const r = Math.max(26, e.displayWidth * 0.6);
  const g = s.add.graphics({ x: e.x, y: e.y }).setDepth(TOP);
  g.lineStyle(4, color, 1).strokeCircle(0, 0, r);
  const L = r * 0.55;
  g.lineStyle(5, C.white, 1);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.beginPath().moveTo(sx * r * 1.25, sy * (r * 1.25 - L)).lineTo(sx * r * 1.25, sy * r * 1.25).lineTo(sx * (r * 1.25 - L), sy * r * 1.25).strokePath();
  }
  g.setScale(2.2).setAlpha(0).setRotation(0.6);
  await tween(s, { targets: g, scale: 1, alpha: 1, rotation: 0, duration: 300, ease: "Cubic.easeOut" });
  await wait(s, 120);
  void tween(s, { targets: g, alpha: 0, scale: 0.7, duration: 160 }).then(() => g.destroy());
}

/** Powers that act on the pharaoh: the camera comes to them and a reticle in the god's colour locks on first. */
async function spotlight(s: GameScene, color: number) {
  const p = s.player;
  if (!p?.active) return;
  await focusOn(s, p.y, 0.6);
  await lockOn(s, p, color);
}

/** The shared rhythm of every targeted power: badges first, then for each target in order:
 *  camera to it, lock on, strike (and wait for it to finish), badge away. */
async function eachTarget(s: GameScene, ids: number[], color: number, strike: (e: Enemy) => Promise<void>) {
  const badges = markTargets(s, ids, color);
  await wait(s, 250 + ids.length * 70);
  for (const id of ids) {
    const e = s.enemyById(id);
    if (!e) { dropBadge(s, badges.get(id)); continue; }
    await focusOn(s, e.y);
    e.setSeenAlpha(1); // lit up, even in the line-of-sight darkness: you see what is hit
    await lockOn(s, e, color);
    dropBadge(s, badges.get(id));
    if (e.active) await strike(e);
    await wait(s, 140);
  }
}

// ---------------------------------------------------------------- the powers

async function smite(s: GameScene, ids: number[]) {
  await eachTarget(s, ids, C.orange, async (e) => {
    const { top } = view(s);
    const g = s.add.graphics().setDepth(TOP);
    const pts: Phaser.Math.Vector2[] = [];
    const sx = e.x + rnd(-90, 90), sy = top + FRAME.top - 10, n = 8;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      pts.push(new Phaser.Math.Vector2(Phaser.Math.Linear(sx, e.x, k) + (i && i < n ? rnd(-26, 26) : 0), Phaser.Math.Linear(sy, e.y, k)));
    }
    for (const [w, c, a] of [[22, C.yellow, 0.22], [10, C.yellow, 1], [4, C.white, 1]] as const) g.lineStyle(w, c, a).strokePoints(pts);
    flash(s, C.white, 0.28, 120);
    s.cameras.main.shake(140, 0.004);
    starburst(s, e.x, e.y, 46, C.orange);
    ring(s, e.x, e.y, 70, C.yellow);
    s.killEnemy(e);
    await tween(s, { targets: g, alpha: 0, duration: 260 });
    g.destroy();
  });
}

async function entomb(s: GameScene, ids: number[]) {
  const key = tombTexture(s);
  await eachTarget(s, ids, C.nile, async (e) => {
    const size = e instanceof Tank ? TILE * 2 : e instanceof Bunker ? TILE * 1.4 : TILE * 1.05;
    const { x, y } = e;
    s.sealEnemy(e);
    e.setTint(0x9a8f86);
    // stone courses rise around it, one after another
    const layers: Phaser.GameObjects.Graphics[] = [];
    for (let k = 0; k < 4; k++) {
      const g = s.add.graphics({ x, y: y - k * 5 }).setDepth(DEPTH.units + 1 + k * 0.01);
      const w = size * (1.15 - k * 0.04), h = 14;
      for (let b = 0; b < 4; b++) { // four walls of blocks
        const horiz = b < 2, sign = b % 2 ? 1 : -1;
        const bw = horiz ? w : h, bh = horiz ? h : w;
        const bx = horiz ? -w / 2 : sign * (w / 2 - h / 2) - h / 2, by = horiz ? sign * (w / 2 - h / 2) - h / 2 : -w / 2;
        g.fillStyle(C.indigo, 0.25).fillRoundedRect(bx + 3, by + 4, bw, bh, 5);
        g.fillStyle(k % 2 ? C.sandDark : C.sand, 1).fillRoundedRect(bx, by, bw, bh, 5);
        g.fillStyle(C.sandLight, 0.9).fillRoundedRect(bx + 2, by + 2, bw - 4, 3, 2);
      }
      g.setScale(0);
      layers.push(g);
      await tween(s, { targets: g, scale: 1, duration: 150, ease: "Back.easeOut" });
      puff(s, x + rnd(-size / 2, size / 2), y + size / 2, [C.sandLight, C.sand], 3, 18);
    }
    const tomb = s.add.image(x, y, key).setDisplaySize(size * 1.2, size * 1.2).setDepth(DEPTH.units + 1.1).setScale(0);
    await tween(s, { targets: tomb, scale: (size * 1.2) / 96, duration: 220, ease: "Back.easeOut" });
    e.hideParts();
    layers.forEach((l) => l.destroy());
    s.addTomb(tomb, size);
    s.cameras.main.shake(90, 0.003);
    say(s, x, y - size / 2 - 10, "SEALED", "#f9dcaa");
  });
}

async function banish(s: GameScene, ids: number[]) {
  await eachTarget(s, ids, C.violet, async (e) => {
    const r = Math.max(34, e.displayWidth * 0.6);
    const portal = s.add.container(e.x, e.y + 4).setDepth(DEPTH.units - 0.5).setScale(0);
    const disc = s.add.graphics();
    disc.fillStyle(C.violet, 1).fillEllipse(0, 0, r * 2.2, r * 1.6);
    disc.fillStyle(C.purple, 1).fillEllipse(0, 0, r * 1.6, r * 1.15);
    disc.fillStyle(C.deep, 1).fillEllipse(0, 0, r * 1.05, r * 0.75);
    const swirl = s.add.graphics();
    for (let k = 0; k < 3; k++) swirl.lineStyle(3, C.pink, 0.8).beginPath().arc(0, 0, r * (0.5 + k * 0.2), k * 2, k * 2 + 2.2).strokePath();
    portal.add([disc, swirl]);
    s.tweens.add({ targets: swirl, rotation: Math.PI * 6, duration: 1600 });
    await tween(s, { targets: portal, scale: 1, duration: 260, ease: "Back.easeOut" });
    e.hideParts(true);
    await tween(s, { targets: e, angle: e.angle + 720, scale: 0, y: e.y + 6, duration: 560, ease: "Cubic.easeIn" });
    s.removeEnemy(e);
    say(s, portal.x, portal.y - 40, "TO THE DUAT", "#b8acff");
    await tween(s, { targets: portal, scale: 0, duration: 220, ease: "Back.easeIn" });
    portal.destroy();
  });
}

async function transform(s: GameScene, ids: number[]) {
  await eachTarget(s, ids, C.pink, async (e) => {
    puff(s, e.x, e.y, [C.pink, C.yellow, C.teal, C.ink], 9, 40);
    await wait(s, 160);
    if (!e.active) return;
    const cat = s.enemyToCat(e);
    cat.setScale(0);
    await tween(s, { targets: cat, scale: 1, duration: 280, ease: "Back.easeOut" });
    say(s, cat.x, cat.y - 30, "♥", "#ff5e7e");
  });
}

/** A flat feather sweeps the sky; every shot in the air becomes a scarab and flutters off. */
async function purify(s: GameScene) {
  // the camera goes to where the shots are (their middle), then the feather sweeps
  const shots = s.projectilePositions();
  if (shots.length) await focusOn(s, shots.reduce((a, b) => a + b.y, 0) / shots.length);
  const { top, x0, x1 } = view(s);
  const feather = s.add.graphics().setDepth(TOP);
  feather.fillStyle(C.ink, 1).fillEllipse(0, 0, 220, 54);
  feather.fillStyle(C.teal, 1).fillEllipse(30, 0, 120, 30);
  feather.lineStyle(4, C.indigo, 0.8).lineBetween(-120, 0, 110, 0);
  for (let k = -90; k < 90; k += 18) feather.lineStyle(2, C.indigo, 0.25).lineBetween(k, -20, k + 10, 0);
  feather.setPosition(x0 - 140, top + 120).setRotation(0.5);
  const sweep = tween(s, { targets: feather, x: x1 + 140, y: top + VIEW_H - 160, rotation: 0.2, duration: 1000, ease: "Sine.easeInOut" });
  await wait(s, 300);
  const spots = s.clearProjectiles();
  for (const p of spots) {
    const bug = s.add.container(p.x, p.y).setDepth(TOP);
    const wings = s.add.graphics();
    wings.fillStyle(p.bomb ? C.yellow : C.teal, 1).fillEllipse(-7, -2, 12, 16).fillEllipse(7, -2, 12, 16);
    wings.fillStyle(C.indigo, 1).fillEllipse(0, 2, 8, 14);
    bug.add(wings);
    s.tweens.add({ targets: wings, scaleX: 0.3, duration: 90, yoyo: true, repeat: 8 });
    void tween(s, { targets: bug, x: p.x + rnd(-80, 80), y: p.y - rnd(120, 220), alpha: 0, duration: rnd(800, 1200), ease: "Sine.easeOut" }).then(() => bug.destroy());
  }
  say(s, VIEW_W / 2, top + VIEW_H / 2, spots.length ? `${spots.length} shots → scarabs` : "the sky is clear", "#a8fff4");
  await sweep;
  feather.destroy();
}

/** A hexagonal sun-shield that follows the pharaoh until it runs out. */
async function shield(s: GameScene, seconds: number) {
  await spotlight(s, C.yellow);
  s.setShield(seconds * 1000);
  const p = s.player;
  const g = s.add.graphics().setDepth(DEPTH.units + 2);
  const pts = Array.from({ length: 6 }, (_, i) => new Phaser.Math.Vector2(Math.cos((i / 6) * Math.PI * 2) * 46, Math.sin((i / 6) * Math.PI * 2) * 46));
  g.fillStyle(C.yellow, 0.16).fillPoints(pts, true).lineStyle(3, C.yellow, 0.9).strokePoints(pts, true);
  const ankhs = [0, 1, 2].map(() => s.add.text(0, 0, "☥", { fontFamily: FONT, fontSize: "16px", color: "#ffd23f", stroke: "#1b1f4b", strokeThickness: 3 }).setOrigin(0.5).setDepth(DEPTH.units + 2.1).setResolution(RES));
  g.setScale(0);
  const follow = () => {
    if (!g.active || !p.active) { s.events.off("postupdate", follow); return; }
    const left = s.shieldUntil - s.time.now;
    if (left <= 0) { s.events.off("postupdate", follow); g.destroy(); ankhs.forEach((a) => a.destroy()); return; }
    const blink = left < 2000 && Math.floor(left / 120) % 2 ? 0.25 : 1;
    g.setPosition(p.x, p.y).setAlpha(blink).rotation += 0.01;
    ankhs.forEach((a, i) => { const ang = s.time.now / 500 + (i / 3) * Math.PI * 2; a.setPosition(p.x + Math.cos(ang) * 54, p.y + Math.sin(ang) * 54).setAlpha(blink); });
  };
  s.events.on("postupdate", follow);
  follow();
  ring(s, p.x, p.y, 90, C.yellow);
  await tween(s, { targets: g, scale: 1, duration: 300, ease: "Back.easeOut" });
}

/** Gifts rain from the sky and fly up into the top bar. */
async function bless(s: GameScene, a: Extract<Power, { power: "bless" }>) {
  await spotlight(s, C.orange);
  const { top } = view(s), p = s.player;
  const icons: Phaser.GameObjects.GameObject[] = [];
  const drop = (obj: Phaser.GameObjects.Container, i: number) => {
    icons.push(obj);
    obj.setPosition(p.x + rnd(-160, 160), top + FRAME.top - 20).setDepth(TOP);
    return tween(s, { targets: obj, x: p.x + rnd(-50, 50), y: p.y - rnd(10, 50), duration: 650, delay: i * 70, ease: "Bounce.easeOut" })
      .then(() => tween(s, { targets: obj, y: top + 20, x: obj.x + rnd(-40, 40), scale: 0.5, alpha: 0, duration: 450, delay: 250, ease: "Cubic.easeIn" }));
  };
  const coin = () => { const g = s.add.graphics(); g.fillStyle(C.orange, 1).fillCircle(2, 3, 11).fillStyle(C.yellow, 1).fillCircle(0, 0, 11).fillStyle(C.white, 0.6).fillCircle(-3, -4, 3); return s.add.container(0, 0, [g]); };
  const ankh = () => { const g = s.add.graphics(); g.fillStyle(C.pink, 1).fillCircle(0, 0, 15); return s.add.container(0, 0, [g, s.add.text(0, 0, "☥", { fontFamily: FONT, fontSize: "18px", color: "#ffffff" }).setOrigin(0.5).setResolution(RES)]); };
  const storm = () => s.add.container(0, 0, [s.add.image(0, 0, "sandbomb").setScale(0.8)]);
  const jobs: Promise<void>[] = [];
  let i = 0;
  for (let k = 0; k < a.lives; k++) jobs.push(drop(ankh(), i++));
  for (let k = 0; k < a.sandstorms; k++) jobs.push(drop(storm(), i++));
  for (let k = 0; k < Math.min(14, Math.ceil(a.score / 400)); k++) jobs.push(drop(coin(), i++));
  await Promise.all(jobs);
  icons.forEach((o) => o.destroy());
  s.bless({ lives: a.lives, sandstorms: a.sandstorms, score: a.score });
  const parts = [a.lives && `+${a.lives} ☥`, a.sandstorms && `+${a.sandstorms} sandstorms`, a.score && `+${a.score}`].filter(Boolean).join("   ");
  say(s, p.x, p.y - 60, parts, "#ffd23f");
}

/** Cats drift down under little clouds and join the army. */
async function summonCats(s: GameScene, n: number) {
  await spotlight(s, C.pink);
  const { top } = view(s), p = s.player;
  const jobs = Array.from({ length: n }, async (_, i) => {
    const sx = p.x + rnd(-260, 260), a = rnd(0, Math.PI * 2), d = rnd(50, 140);
    const ex = Phaser.Math.Clamp(p.x + Math.cos(a) * d, FRAME.side + 20, VIEW_W - FRAME.side - 20), ey = p.y + Math.sin(a) * d;
    const cloud = s.add.graphics();
    cloud.fillStyle(C.ink, 1).fillCircle(-12, -26, 10).fillCircle(0, -32, 13).fillCircle(13, -26, 10).fillRect(-12, -26, 25, 9);
    const cat = s.add.image(0, 0, "cat").setTint(0xf2e6cc).setRotation(Math.PI / 2);
    const box = s.add.container(sx, top - 30, [cat, cloud]).setDepth(TOP - 1);
    s.tweens.add({ targets: box, angle: { from: -8, to: 8 }, duration: 400, yoyo: true, repeat: -1 });
    await tween(s, { targets: box, x: ex, y: ey, duration: rnd(900, 1400), delay: i * Math.min(90, 2500 / n), ease: "Sine.easeOut" }); // a big summoning arrives in ~2.5 s
    puff(s, ex, ey - 28, [C.ink, C.white], 5, 22);
    box.destroy();
    s.spawnArmyCat(ex, ey);
  });
  await Promise.all(jobs);
  say(s, p.x, p.y - 60, `+${n} cats`, "#ff5e7e");
}

async function slowTime(s: GameScene, seconds: number) {
  await spotlight(s, C.teal);
  const { cx, cy, top } = view(s);
  const tint = s.add.rectangle(0, top, VIEW_W, VIEW_H, C.violet, 0).setOrigin(0).setDepth(TOP - 2);
  const glass = s.add.graphics({ x: cx, y: cy }).setDepth(TOP);
  glass.fillStyle(C.ink, 0.9).fillRoundedRect(-70, -110, 140, 16, 8).fillRoundedRect(-70, 94, 140, 16, 8);
  glass.fillStyle(C.teal, 0.55).fillTriangle(-56, -94, 56, -94, 0, 0).fillTriangle(-56, 94, 56, 94, 0, 0);
  glass.fillStyle(C.sand, 1).fillTriangle(-30, -52, 30, -52, 0, -4).fillTriangle(-46, 94, 46, 94, 0, 46);
  glass.setScale(0).setAlpha(0.9);
  s.slowEnemies(seconds * 1000, 1 / 3);
  void tween(s, { targets: tint, fillAlpha: 0.16, duration: 300, yoyo: true, hold: 600 }).then(() => tint.destroy());
  await tween(s, { targets: glass, scale: 1.2, duration: 320, ease: "Back.easeOut" });
  await tween(s, { targets: glass, rotation: Math.PI, duration: 700, ease: "Cubic.easeInOut" });
  say(s, cx, cy + 140, `time crawls · ${seconds}s`, "#b8acff");
  await tween(s, { targets: glass, alpha: 0, scale: 1.6, duration: 300 });
  glass.destroy();
}

/** The Eye of Ra opens over the screen and the darkness peels away. */
async function reveal(s: GameScene, seconds: number) {
  await spotlight(s, C.teal);
  const { cx, cy } = view(s);
  const eye = s.add.graphics({ x: cx, y: cy }).setDepth(TOP);
  eye.fillStyle(C.ink, 1).fillEllipse(0, 0, 220, 110);
  eye.fillStyle(C.teal, 1).fillCircle(0, 0, 40);
  eye.fillStyle(C.indigo, 1).fillCircle(0, 0, 20);
  eye.fillStyle(C.white, 1).fillCircle(-12, -12, 8);
  eye.lineStyle(10, C.indigo, 1).beginPath().arc(0, 0, 112, Math.PI * 1.15, Math.PI * 1.85).strokePath(); // brow
  eye.lineStyle(9, C.indigo, 1).lineBetween(-20, 52, -26, 110).beginPath().arc(30, 70, 34, 0, Math.PI * 1.3).strokePath(); // Horus marks
  eye.setScale(0, 0);
  await tween(s, { targets: eye, scaleX: 1, scaleY: 0.08, duration: 200, ease: "Cubic.easeOut" });
  await tween(s, { targets: eye, scaleY: 1, duration: 260, ease: "Back.easeOut" });
  s.reveal(seconds * 1000);
  ring(s, cx, cy, 600, C.ink, 14);
  flash(s, C.ink, 0.25, 300);
  await wait(s, 350);
  await tween(s, { targets: eye, alpha: 0, scale: 1.4, duration: 300 });
  eye.destroy();
}

/** A sun disc falls on the Pharaoh's chariot. */
async function defeatBoss(s: GameScene) {
  const boss = s.bossEnemy;
  if (!boss) return;
  await focusOn(s, boss.y);
  boss.setSeenAlpha(1);
  await lockOn(s, boss, C.orange);
  const { top } = view(s);
  const sun = s.add.container(boss.x, top - 140).setDepth(TOP);
  const rays = s.add.graphics();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    rays.fillStyle(i % 2 ? C.orange : C.yellow, 1).fillTriangle(Math.cos(a - 0.12) * 60, Math.sin(a - 0.12) * 60, Math.cos(a + 0.12) * 60, Math.sin(a + 0.12) * 60, Math.cos(a) * 110, Math.sin(a) * 110);
  }
  const disc = s.add.graphics();
  disc.fillStyle(C.orange, 1).fillCircle(4, 6, 62).fillStyle(C.yellow, 1).fillCircle(0, 0, 62).fillStyle(C.white, 0.5).fillCircle(-20, -22, 16);
  sun.add([rays, disc]);
  s.tweens.add({ targets: rays, rotation: Math.PI * 2, duration: 2000, repeat: -1 });
  await tween(s, { targets: sun, y: boss.y, duration: 900, ease: "Cubic.easeIn" });
  flash(s, C.yellow, 0.5, 400);
  s.cameras.main.shake(400, 0.012);
  starburst(s, boss.x, boss.y, 120, C.orange);
  ring(s, boss.x, boss.y, 260, C.yellow, 10);
  puff(s, boss.x, boss.y, [C.sand, C.sandDark, C.ink], 12, 90);
  if (boss.active) s.killEnemy(boss);
  await tween(s, { targets: sun, alpha: 0, scale: 1.6, duration: 400 });
  sun.destroy();
}

/** Ra lifts the pharaoh in a column of light, rushes the camera over the land, and sets them down. */
async function ascend(s: GameScene, to: Extract<Power, { power: "ascend" }>["to"]) {
  await spotlight(s, C.orange);
  const p = s.player, dest = s.landingSpot(to);
  const column = (x: number, y: number) => {
    const { top } = view(s);
    const g = s.add.graphics({ x, y: 0 }).setDepth(DEPTH.units + 3);
    g.fillStyle(C.yellow, 0.25).fillRect(-50, top, 100, y - top + 40).fillStyle(C.white, 0.55).fillRect(-16, top, 32, y - top + 40);
    return g.setScale(0, 1);
  };
  const up = column(p.x, p.y);
  await tween(s, { targets: up, scaleX: 1, duration: 260, ease: "Back.easeOut" });
  const bubble = s.add.circle(p.x, p.y, 40, C.yellow, 0.25).setStrokeStyle(3, C.white).setDepth(DEPTH.units + 3.1);
  await tween(s, { targets: [p, bubble], scale: 1.3, duration: 260, ease: "Back.easeOut" });
  void tween(s, { targets: up, alpha: 0, duration: 300 }).then(() => up.destroy());

  // the rush: speed lines while the camera travels; the pharaoh rides along in the light
  const startTop = s.viewTop, endTop = Phaser.Math.Clamp(dest.y - VIEW_H * 0.6, 0, s.worldSnapshot().rows * TILE - VIEW_H);
  const offset = p.y - startTop, lines = s.add.graphics().setDepth(TOP - 1);
  const travel = { k: 0 };
  await tween(s, {
    targets: travel, k: 1, duration: Phaser.Math.Clamp(Math.abs(endTop - startTop) * 0.25, 500, 1400), ease: "Sine.easeInOut",
    onUpdate: () => {
      const vt = Phaser.Math.Linear(startTop, endTop, travel.k);
      s.viewTop = vt;
      p.setPosition(Phaser.Math.Linear(p.x, dest.x, 0.08), vt + Phaser.Math.Linear(offset, dest.y - endTop, travel.k));
      bubble.setPosition(p.x, p.y);
      lines.clear();
      const speed = Math.sin(travel.k * Math.PI);
      for (let i = 0; i < 26; i++) {
        const x = (i * 97) % VIEW_W, y = vt + ((i * 211 + travel.k * 3000) % VIEW_H);
        lines.lineStyle(2 + (i % 3), C.ink, 0.5 * speed).lineBetween(x, y, x, y + 60 + 140 * speed);
      }
    },
  });
  lines.destroy();
  s.teleportPlayer(dest.x, dest.y);
  bubble.setPosition(dest.x, dest.y);
  const down = column(dest.x, dest.y);
  down.setScale(1, 1).setAlpha(0.8);
  ring(s, dest.x, dest.y, 160, C.yellow, 8);
  starburst(s, dest.x, dest.y, 60, C.orange);
  s.cameras.main.shake(160, 0.005);
  await tween(s, { targets: [p, bubble], scale: 1, duration: 260, ease: "Back.easeIn" });
  bubble.destroy();
  void tween(s, { targets: down, alpha: 0, duration: 500 }).then(() => down.destroy());
  say(s, dest.x, dest.y - 60, to === "temple" ? "THE TEMPLE" : "ARRIVED", "#ffd23f");
}

/** Thoth unrolls a papyrus over the rows while the land is rewritten (by the map agent). */
async function reshape(s: GameScene, a: Extract<Power, { power: "reshape" }>, hooks: PowerHooks) {
  const { x0, x1 } = view(s);
  const y0 = a.rows[0] * TILE, h = (a.rows[1] - a.rows[0] + 1) * TILE;
  await focusOn(s, y0 + h / 2, 0.5, true); // glide to the rows being rewritten
  const scroll = s.add.graphics({ x: 0, y: y0 }).setDepth(TOP - 1); // unrolls downward from the first row
  scroll.fillStyle(C.indigo, 0.25).fillRoundedRect(x0 + 6, 8, x1 - x0, h, 12);
  scroll.fillStyle(C.sandLight, 0.92).fillRoundedRect(x0, 0, x1 - x0, h, 12);
  for (let y = 24; y < h - 16; y += 22) {
    for (let x = x0 + 24; x < x1 - 40; x += rnd(30, 70)) scroll.fillStyle(C.indigo, 0.35).fillRoundedRect(x, y, rnd(10, 26), 6, 3);
  }
  scroll.setScale(1, 0);
  await tween(s, { targets: scroll, scaleY: 1, duration: 600, ease: "Cubic.easeOut" });
  const pulse = s.tweens.add({ targets: scroll, alpha: 0.65, duration: 500, yoyo: true, repeat: -1 });
  say(s, VIEW_W / 2, y0 + h / 2, "Thoth rewrites the land…", "#1b1f4b");
  const result = await hooks.reshape(a);
  if (!alive(s) || !scroll.active) return; // the world rebuilt with the new rows
  pulse.stop();
  say(s, VIEW_W / 2, y0 + h / 2, result.message, result.ok ? "#2ec4b6" : "#ff5e7e");
  await tween(s, { targets: scroll, scaleY: 0, alpha: 0, duration: 400, ease: "Cubic.easeIn" });
  scroll.destroy();
}

// ---------------------------------------------------------------- running a decree

export async function performDecree(s: GameScene, decree: Decree, hooks: PowerHooks) {
  if (!decree.actions.length) return;
  s.setCinematic(true);
  try {
    for (const a of decree.actions) {
      if (!alive(s)) return;
      await callout(s, a.power);
      switch (a.power) {
        case "smite": await smite(s, a.targets); break;
        case "entomb": await entomb(s, a.targets); break;
        case "banish": await banish(s, a.targets); break;
        case "transform": await transform(s, a.targets); break;
        case "purify": await purify(s); break;
        case "shield": await shield(s, a.seconds); break;
        case "bless": await bless(s, a); break;
        case "summon_cats": await summonCats(s, a.n); break;
        case "slow_time": await slowTime(s, a.seconds); break;
        case "reveal": await reveal(s, a.seconds); break;
        case "defeat_boss": await defeatBoss(s); break;
        case "ascend": await ascend(s, a.to); break;
        case "reshape": s.setCinematic(false); await reshape(s, a, hooks); break;
      }
      await wait(s, 150);
    }
    if (alive(s) && s.player?.active) await focusOn(s, s.player.y, 0.6); // back to the pharaoh
  } finally {
    if (alive(s)) s.setCinematic(false);
  }
}

// ---------------------------------------------------------------- pranks (refusals only; harmless)

function camel(s: GameScene) {
  const { top, x0 } = view(s);
  const c = s.add.container(x0 - 80, top + VIEW_H * 0.62).setDepth(TOP - 1);
  const g = s.add.graphics();
  g.fillStyle(C.indigo, 0.2).fillEllipse(6, 58, 120, 18);
  g.fillStyle(C.sandDark, 1).fillRoundedRect(-36, 20, 10, 38, 4).fillRoundedRect(26, 20, 10, 38, 4); // far legs
  g.fillStyle(C.sand, 1).fillEllipse(0, 14, 96, 46).fillCircle(-6, -6, 22); // body, hump
  g.fillStyle(C.sand, 1).fillRoundedRect(34, -30, 16, 50, 8).fillEllipse(52, -34, 34, 20); // neck, head
  g.fillStyle(C.sandLight, 1).fillEllipse(-14, -16, 18, 8);
  g.fillStyle(C.indigo, 1).fillCircle(58, -38, 3);
  g.fillStyle(C.sand, 1).fillRoundedRect(-28, 22, 10, 38, 4).fillRoundedRect(18, 22, 10, 38, 4); // near legs
  c.add(g);
  s.tweens.add({ targets: g, y: -4, duration: 260, yoyo: true, repeat: -1 });
  void tween(s, { targets: c, x: VIEW_W + 100, duration: 6000, ease: "Linear" }).then(() => c.destroy());
  say(s, VIEW_W / 2, top + VIEW_H * 0.5, "a camel.", "#f9dcaa");
}

export function performPrank(s: GameScene, prank: Prank) {
  const p = s.player, { top } = view(s);
  if (prank === "tiny") {
    s.tweens.add({ targets: p, scale: 0.5, duration: 300, ease: "Back.easeOut", yoyo: true, hold: 6000 });
    say(s, p.x, p.y - 40, "tiny pharaoh!", "#ffd23f");
  } else if (prank === "frog") {
    p.setTint(0x7ed957);
    for (let i = 0; i < 4; i++) s.time.delayedCall(i * 1400, () => say(s, s.player.x + rnd(-20, 20), s.player.y - 40, "ribbit", "#7ed957"));
    s.time.delayedCall(6000, () => s.player?.clearTint());
  } else if (prank === "camel") camel(s);
  else if (prank === "confetti") {
    for (let i = 0; i < 90; i++) {
      const bit = s.add.rectangle(rnd(0, VIEW_W), top - rnd(0, 200), rnd(5, 9), rnd(8, 14), Phaser.Utils.Array.GetRandom([C.sand, C.sandDark, C.yellow, C.pink, C.teal])).setDepth(TOP);
      void tween(s, { targets: bit, y: top + VIEW_H + 40, x: bit.x + rnd(-60, 60), angle: rnd(-540, 540), duration: rnd(1600, 2800), ease: "Sine.easeIn" }).then(() => bit.destroy());
    }
  } else if (prank === "cat") {
    const cat = s.add.image(VIEW_W - 40, top + 80, "cat").setTint(0xe0903a).setDepth(TOP);
    const from = { x: cat.x, y: cat.y }, k = { t: 0 };
    void tween(s, {
      targets: k, t: 1, duration: 800, ease: "Linear",
      onUpdate: () => { cat.setPosition(Phaser.Math.Linear(from.x, s.player.x, k.t), Phaser.Math.Linear(from.y, s.player.y, k.t) - Math.sin(k.t * Math.PI) * 120).rotation += 0.3; },
    }).then(() => { cat.destroy(); s.spawnArmyCat(s.player.x, s.player.y + 20); say(s, s.player.x, s.player.y - 40, "catch!", "#ff5e7e"); });
  }
}

