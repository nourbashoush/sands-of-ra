import Phaser from "phaser";
import { RES } from "./config";
import { FONT } from "./style";

// Depth layers, bottom to top.
export const DEPTH = {
  ground: 0,
  decals: 1,
  wallShadow: 2,
  walls: 3,
  objShadow: 4,
  obstacles: 5,
  unitShadow: 6,
  units: 10,
  bullets: 12,
  fx: 15,
  canopy: 20,
  sight: 21, // line-of-sight darkness
  litWalls: 21.2, // walls and monuments, drawn above the darkness so visible ones stay readable
  wallCover: 21.4, // darkness over walls the player can't see
  text: 30,
  screen: 40,
};

// Visual effects in the flat house style (starbursts, rounded puffs, little stars; see art.ts for the
// fx_* textures). Everything here is cosmetic: no gameplay state.
export class Fx {
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private debris: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(private scene: Phaser.Scene) {
    this.sparks = scene.add.particles(0, 0, "fx_star", {
      speed: { min: 120, max: 420 },
      lifespan: { min: 250, max: 550 },
      scale: { start: 0.9, end: 0 },
      rotate: { min: 0, max: 360 },
      tint: [0xffd23f, 0xff9f1c, 0xff5e7e, 0xf4f1ea],
      emitting: false,
    });
    this.sparks.setDepth(DEPTH.fx + 1);
    this.debris = scene.add.particles(0, 0, "fx_chip", {
      speed: { min: 60, max: 220 },
      lifespan: { min: 300, max: 700 },
      scale: { start: 0.6, end: 0.25 },
      rotate: { min: 0, max: 360 },
      tint: [0xf6c177, 0xe9955a, 0xf9dcaa, 0x3a2d6b],
      emitting: false,
    });
    this.debris.setDepth(DEPTH.fx);
  }

  explosion(x: number, y: number, size = 1) {
    const s = this.scene;
    // flat starburst: a yellow burst with a white core, popping out then shrinking away
    const rot = Math.random() * Math.PI;
    const burst = s.add.image(x, y, "fx_burst").setDepth(DEPTH.fx + 2).setTint(0xffd23f).setScale(0.3 * size).setRotation(rot);
    const core = s.add.image(x, y, "fx_burst").setDepth(DEPTH.fx + 2.1).setTint(0xfffbe0).setScale(0.15 * size).setRotation(rot + 0.26);
    s.tweens.add({ targets: burst, scale: 1.25 * size, duration: 90, yoyo: true, hold: 30, ease: "Back.easeOut", onComplete: () => burst.destroy() });
    s.tweens.add({ targets: core, scale: 0.7 * size, duration: 80, yoyo: true, hold: 20, onComplete: () => core.destroy() });
    // a ring rolling outwards
    const ring = s.add.image(x, y, "fx_ring").setDepth(DEPTH.fx + 1.5).setTint(0xf4f1ea).setScale(0.2 * size);
    s.tweens.add({ targets: ring, scale: 1.3 * size, alpha: 0, duration: 320, ease: "Cubic.easeOut", onComplete: () => ring.destroy() });

    // fireballs
    for (let i = 0; i < 5 + 3 * size; i++) {
      const frame = Phaser.Math.Between(0, 5);
      const fb = s.add
        .image(x + Phaser.Math.Between(-20, 20) * size, y + Phaser.Math.Between(-20, 20) * size, `smoke_${i % 3 ? "orange" : "yellow"}${frame}`)
        .setDepth(DEPTH.fx)
        .setScale(0.3 * size)
        .setRotation(Phaser.Math.FloatBetween(-0.4, 0.4)); // keep the light roughly top-left
      s.tweens.add({
        targets: fb,
        scale: (0.7 + Math.random() * 0.5) * size,
        alpha: 0,
        duration: 350 + Math.random() * 250,
        delay: i * 25,
        onComplete: () => fb.destroy(),
      });
    }
    // lingering smoke
    for (let i = 0; i < 4 + 2 * size; i++) {
      const sm = s.add
        .image(x + Phaser.Math.Between(-24, 24) * size, y + Phaser.Math.Between(-24, 24) * size, `smoke_grey${Phaser.Math.Between(0, 5)}`)
        .setDepth(DEPTH.fx - 1)
        .setAlpha(0.7)
        .setScale(0.4 * size);
      s.tweens.add({
        targets: sm,
        y: sm.y - 40,
        scale: 1.1 * size,
        alpha: 0,
        duration: 1400 + Math.random() * 800,
        delay: 150 + i * 60,
        onComplete: () => sm.destroy(),
      });
    }
    this.sparks.explode(Math.round(18 * size), x, y);
    this.debris.explode(Math.round(10 * size), x, y);
    this.scorch(x, y, size);
    s.cameras.main.shake(120 + 120 * size, 0.004 * size);
  }

  scorch(x: number, y: number, size = 1) {
    const sc = this.scene.add
      .image(x, y, "scorch")
      .setDepth(DEPTH.decals)
      .setAlpha(0.45)
      .setScale(0.7 * size)
      .setRotation(Math.random() * Math.PI * 2);
    this.scene.tweens.add({ targets: sc, alpha: 0.25, duration: 20000 });
  }

  muzzle(x: number, y: number, rotation: number, size = 1) {
    const f = this.scene.add
      .image(x, y, "fx_burst")
      .setDepth(DEPTH.fx)
      .setTint(0xffd23f)
      .setScale(0.22 * size, 0.14 * size)
      .setRotation(rotation);
    this.scene.time.delayedCall(40, () => f.destroy());
  }

  impact(x: number, y: number) {
    this.sparks.explode(5, x, y);
    const puff = this.scene.add.image(x, y, `smoke_white${Phaser.Math.Between(0, 5)}`).setDepth(DEPTH.fx).setScale(0.15).setAlpha(0.7);
    this.scene.tweens.add({ targets: puff, scale: 0.35, alpha: 0, duration: 300, onComplete: () => puff.destroy() });
  }

  hitFlash(target: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image) {
    const prev = target.tintTopLeft;
    target.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => target.active && target.setTint(prev));
  }

  floatingText(x: number, y: number, text: string, color = "#ffe27a") {
    const t = this.scene.add
      .text(x, y, text, { fontFamily: FONT, fontSize: "20px", fontStyle: "bold", color })
      .setOrigin(0.5)
      .setDepth(DEPTH.text)
      .setStroke("#1b1f4b", 5)
      .setResolution(RES);
    this.scene.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 1100, onComplete: () => t.destroy() });
  }

  /** Screen-space desert air: warm sunlight from the top-left and sand blowing across. */
  desertAir(w: number, h: number): Phaser.GameObjects.GameObject[] {
    // screen-space: offset for the camera's zoom about its centre (see GameScene's overlays)
    const ox = (w * (RES - 1)) / 2, oy = (h * (RES - 1)) / 2;
    const glow = this.scene.add.image(ox, oy, "glow").setScrollFactor(0).setDepth(DEPTH.screen - 1)
      .setScale(26).setTint(0xffd23f).setAlpha(0.16).setBlendMode(Phaser.BlendModes.ADD);
    const sand = this.scene.add.particles(ox, oy, "streak", {
      x: { min: -200, max: w * 0.6 },
      y: { min: -40, max: h },
      speedX: { min: 260, max: 520 },
      speedY: { min: 40, max: 110 },
      rotate: 12,
      scaleX: { min: 1, max: 3 },
      alpha: { start: 0.35, end: 0 },
      lifespan: 2200,
      frequency: 45,
    }).setScrollFactor(0).setDepth(DEPTH.canopy + 2);
    return [glow, sand];
  }

  /**
   * The sandstorm bomb: a dust devil. A spinning vortex at the centre, a dome of dust puffs and
   * a swarm of sand grains orbiting it (faster towards the middle), streaks whipping round the
   * rim, pebbles and twigs flung about, and a scoured ring left on the ground afterwards.
   */
  sandstorm(x: number, y: number, radius: number, ms: number) {
    const s = this.scene;
    type Orbiter = { o: Phaser.GameObjects.Image; r: number; a: number; w: number; wobble: number; lift: number; spin: number };
    const orbiters: Orbiter[] = [];
    const sandTints = [0xf6c177, 0xe9955a, 0xf9dcaa, 0xff9f1c, 0xf4f1ea];
    const orbit = (o: Phaser.GameObjects.Image, r: number, speed: number, lift = 0, spin = 0) => {
      // angular speed grows towards the eye of the storm
      orbiters.push({ o, r, a: Math.random() * Math.PI * 2, w: speed * (1.4 - r / radius), wobble: Math.random() * 10, lift, spin });
    };

    const ground = s.add.image(x, y, "shadow").setDepth(DEPTH.decals + 0.6).setAlpha(0).setScale((radius * 2.2) / 64).setTint(0x3a2d6b);
    const vortex = s.add.image(x, y, "vortex").setDepth(DEPTH.fx).setAlpha(0).setScale((radius * 1.6) / 256);
    const vortex2 = s.add.image(x, y, "vortex").setDepth(DEPTH.fx + 0.5).setAlpha(0).setScale((radius * 1.1) / 256).setFlipX(true);
    const glow = s.add.image(x, y, "glow").setDepth(DEPTH.fx + 0.4).setTint(0xffd890).setAlpha(0).setScale((radius * 2) / 32);
    for (let i = 0; i < 36; i++) { // dust dome
      const r = radius * Phaser.Math.FloatBetween(0.15, 0.95);
      const puff = s.add.image(x, y, `smoke_white${i % 6}`).setDepth(DEPTH.fx + (r < radius / 2 ? 1 : 0.2))
        .setTint(Phaser.Utils.Array.GetRandom(sandTints)).setScale(Phaser.Math.FloatBetween(0.3, 0.6)).setAlpha(0);
      orbit(puff, r, Phaser.Math.FloatBetween(1.5, 2.6), 0, Phaser.Math.FloatBetween(-2, 2));
    }
    for (let i = 0; i < 200; i++) { // sand grains
      const grain = s.add.image(x, y, "fx_dot").setDepth(DEPTH.fx + 2).setTint(Phaser.Utils.Array.GetRandom(sandTints)).setScale(Phaser.Math.FloatBetween(0.3, 0.8)).setAlpha(0);
      orbit(grain, radius * Math.sqrt(Math.random()), Phaser.Math.FloatBetween(3, 5.5));
    }
    for (let i = 0; i < 18; i++) { // streaks whipping round the rim
      const streak = s.add.image(x, y, "streak").setDepth(DEPTH.fx + 2.5).setScale(Phaser.Math.FloatBetween(1.5, 3), 1).setAlpha(0);
      orbit(streak, radius * Phaser.Math.FloatBetween(0.6, 1.05), Phaser.Math.FloatBetween(3.5, 5));
    }
    // the storm is charged with sunlight: a blazing core, turning rays, glowing embers and static
    const add = Phaser.BlendModes.ADD;
    const light = s.add.image(x, y, "glow").setDepth(DEPTH.fx - 0.5).setBlendMode(add).setTint(0xffb040).setAlpha(0).setScale((radius * 3.2) / 32);
    const rays = s.add.image(x, y, "sunrays").setDepth(DEPTH.fx + 3).setBlendMode(add).setAlpha(0).setScale((radius * 2.2) / 256);
    const rays2 = s.add.image(x, y, "sunrays").setDepth(DEPTH.fx + 3).setBlendMode(add).setAlpha(0).setScale((radius * 1.5) / 256).setTint(0xffa040);
    const core = s.add.image(x, y, "flash").setDepth(DEPTH.fx + 3.5).setBlendMode(add).setAlpha(0).setScale(1.2);
    const lightning = s.add.graphics().setDepth(DEPTH.fx + 4).setBlendMode(add);
    let nextBolt = 0;
    for (let i = 0; i < 50; i++) { // embers
      const ember = s.add.image(x, y, "fx_star").setDepth(DEPTH.fx + 3).setBlendMode(add)
        .setTint(Phaser.Utils.Array.GetRandom([0xffd23f, 0xff9f1c, 0xfff1a8, 0xff5e7e])).setScale(Phaser.Math.FloatBetween(0.35, 0.8)).setAlpha(0);
      orbit(ember, radius * Math.sqrt(Math.random()) * 0.9, Phaser.Math.FloatBetween(3, 6), Phaser.Math.FloatBetween(0, 14));
    }
    // a bright shockwave as it bursts open
    const wave = s.add.circle(x, y, 10).setStrokeStyle(6, 0xffd23f, 0.9).setDepth(DEPTH.fx + 3).setBlendMode(add);
    s.tweens.add({ targets: wave, radius: radius * 1.2, alpha: 0, duration: 450, ease: "Cubic.easeOut", onComplete: () => wave.destroy() });

    for (let i = 0; i < 10; i++) { // debris: pebbles and twigs caught in the wind
      const bit = s.add.image(x, y, i % 2 ? "shrub" : "fx_chip").setDepth(DEPTH.fx + 2)
        .setScale(i % 2 ? 0.35 : 0.7).setTint(i % 2 ? 0xffffff : 0xe9955a).setAlpha(0);
      orbit(bit, radius * Phaser.Math.FloatBetween(0.4, 0.9), Phaser.Math.FloatBetween(2.5, 4), Phaser.Math.FloatBetween(10, 26), Phaser.Math.FloatBetween(4, 9));
    }

    const t0 = s.time.now;
    const step = (_time: number, delta: number) => {
      if (!vortex.active) { s.events.off("update", step); return; } // scene restarted mid-storm
      const t = s.time.now - t0, dt = delta / 1000;
      // intensity: blows up fast, holds, dies away
      const k = t < 300 ? t / 300 : t > ms - 700 ? Math.max(0, (ms - t) / 700) : 1;
      const gust = 0.85 + 0.15 * Math.sin(t / 90);
      for (const p of orbiters) {
        p.a += p.w * dt * (0.6 + 0.4 * k);
        const r = p.r * (0.4 + 0.6 * k) + Math.sin(t / 200 + p.wobble) * 6;
        p.o.setPosition(x + Math.cos(p.a) * r, y + Math.sin(p.a) * r * 0.8 - p.lift * Math.abs(Math.sin(t / 300 + p.wobble)));
        p.o.rotation = p.spin ? p.o.rotation + p.spin * dt : p.a + Math.PI / 2; // streaks and grains follow the wind
        const base = p.o.texture.key === "fx_dot" || p.o.texture.key === "fx_star" ? 0.9 : p.o.texture.key === "streak" ? 0.55 : p.o.texture.key.startsWith("smoke") ? 0.8 : 1;
        p.o.setAlpha(base * k * gust);
      }
      vortex.rotation += dt * 5;
      vortex2.rotation -= dt * 8;
      vortex.setAlpha(0.75 * k).setScale(((radius * 1.6) / 256) * (0.9 + 0.1 * Math.sin(t / 120)));
      vortex2.setAlpha(0.6 * k);
      glow.setAlpha(0.18 * k * gust);
      ground.setAlpha(0.5 * k);
      const flicker = 0.8 + 0.2 * Math.sin(t / 37) * Math.sin(t / 53);
      light.setAlpha(0.35 * k * flicker);
      rays.setAlpha(0.5 * k * flicker).rotation += dt * 0.6;
      rays2.setAlpha(0.45 * k).rotation -= dt * 1.1;
      core.setAlpha(0.9 * k * flicker).setScale(1 + 0.25 * Math.sin(t / 80));
      // static crackling through the dust
      if (t > nextBolt && k > 0.5) {
        nextBolt = t + Phaser.Math.Between(90, 260);
        lightning.clear();
        let a = Math.random() * Math.PI * 2, r = radius * 0.15;
        let px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        lightning.lineStyle(3, 0xfff1a8, 0.95).beginPath().moveTo(px, py);
        for (let i = 0; i < 6; i++) {
          r += radius * 0.13; a += Phaser.Math.FloatBetween(-0.5, 0.5);
          px = x + Math.cos(a) * r; py = y + Math.sin(a) * r * 0.8;
          lightning.lineTo(px, py);
        }
        lightning.strokePath();
        s.tweens.add({ targets: lightning, alpha: { from: 1, to: 0 }, duration: 120 });
      }
      if (t > ms) {
        s.events.off("update", step);
        for (const o of [...orbiters.map((p) => p.o), vortex, vortex2, glow, ground, light, rays, rays2, core, lightning]) o.destroy();
      }
    };
    s.events.on("update", step);

    // a ring of scoured sand stays behind
    const scour = s.add.image(x, y, "vortex").setDepth(DEPTH.decals).setAlpha(0).setScale((radius * 1.8) / 256).setTint(0xe9955a);
    s.tweens.add({ targets: scour, alpha: 0.35, delay: ms - 600, duration: 600 });
    s.tweens.add({ targets: scour, alpha: 0, delay: ms + 6000, duration: 4000, onComplete: () => scour.destroy() });
    s.cameras.main.shake(250, 0.004);
  }

  /** Sand trickling out of the thrown sandstorm sack. */
  sandTrickle(x: number, y: number) {
    const g = this.scene.add.image(x + Phaser.Math.Between(-4, 4), y + 6, "fx_dot").setDepth(DEPTH.bullets - 0.1).setTint(0xf6c177).setScale(0.6);
    this.scene.tweens.add({ targets: g, y: y + 30, alpha: 0, duration: 400, onComplete: () => g.destroy() });
  }

  /** Glowing motes shed by ankh bolts; hotter and bigger the more cats you have. */
  sparkle(x: number, y: number, cats: number, color: number) {
    const m = this.scene.add.image(x, y, "fx_star").setDepth(DEPTH.bullets).setBlendMode(Phaser.BlendModes.ADD).setTint(color)
      .setScale(0.4 + 0.5 * Math.min(1, cats / 30)).setRotation(Math.random() * Math.PI);
    this.scene.tweens.add({ targets: m, scale: 0, angle: m.angle + 90, alpha: 0, x: x + Phaser.Math.Between(-12, 12), y: y + Phaser.Math.Between(-12, 12), duration: 350, onComplete: () => m.destroy() });
  }

  /** Three quick scratch marks where a cat bites. */
  claw(x: number, y: number) {
    const g = this.scene.add.graphics().setDepth(DEPTH.fx + 1);
    g.lineStyle(3, 0xf4f1ea, 0.95);
    for (let i = -1; i <= 1; i++) g.lineBetween(x - 8 + i * 5, y - 9, x + 4 + i * 5, y + 9);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  /** Puff of sand kicked up by wheels and hooves. */
  dust(x: number, y: number) {
    const d = this.scene.add.image(x, y, `smoke_white${Phaser.Math.Between(0, 5)}`).setDepth(DEPTH.units - 1).setScale(0.2).setAlpha(0.6).setTint(0xf9dcaa);
    this.scene.tweens.add({ targets: d, scale: 0.6, alpha: 0, duration: 700, onComplete: () => d.destroy() });
  }

  // Soft shadow that follows a unit.
  shadow(scale = 1) {
    return this.scene.add.image(0, 0, "shadow").setDepth(DEPTH.unitShadow).setScale(scale);
  }
}
