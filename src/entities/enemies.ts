import Phaser from "phaser";
import { ENEMIES, SANDSTORM, TILE } from "../config";
import { DEPTH } from "../fx";
import type { GameScene } from "../scenes/GameScene";
import { difficulty } from "../settings";

// Enemy behaviours, hard-coded per type (workshop exercise 1 starting point).

let nextUid = 0;

export abstract class Enemy extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  hp: number;
  abstract readonly score: number;
  /** Bullets only ping off armoured enemies; they need grenades or explosions. */
  armored = false;
  protected shadowImg: Phaser.GameObjects.Image;
  protected nextShot: number;
  /** Set by sandstorms: until then the enemy can't see to shoot and moves slowly. */
  blindUntil = 0;
  /** A stable id, so the council of the gods can name this enemy (src/council/). */
  readonly uid = ++nextUid;
  /** Entombed by the gods: frozen inside a stone tomb, out of the fight. */
  sealed = false;

  constructor(protected world: GameScene, x: number, y: number, texture: string, hp: number, shadowScale: number) {
    super(world, x, y, texture);
    world.add.existing(this);
    world.physics.add.existing(this);
    this.hp = hp;
    this.setDepth(DEPTH.units);
    this.shadowImg = world.fx.shadow(shadowScale);
    this.nextShot = world.time.now + Phaser.Math.Between(800, 1800);
  }

  /** Called every frame while the enemy is on screen. */
  abstract think(time: number, player: Phaser.Math.Vector2): void;

  update(time: number, player: Phaser.Math.Vector2) {
    if (this.sealed) return;
    const blind = time < this.blindUntil;
    if (blind) this.nextShot = Math.max(this.nextShot, this.blindUntil + 300);
    const shotBefore = this.nextShot;
    this.think(time, player);
    if (blind) this.body.velocity.scale(SANDSTORM.slow);
    if (this.nextShot !== shotBefore) this.nextShot = time + (this.nextShot - time) * difficulty().fireEvery; // easy: shoots less often
    const slow = this.world.slowFactor(time); // Thoth's slowed time
    if (slow < 1) {
      this.body.velocity.scale(slow);
      if (this.nextShot !== shotBefore) this.nextShot = time + (this.nextShot - time) / slow;
    }
    this.shadowImg.setPosition(this.x + 5, this.y + 7);
  }

  damage(amount: number, fromBullet: boolean) {
    if (!this.active || this.sealed) return;
    if (fromBullet && this.armored) {
      this.world.fx.impact(this.x, this.y);
      return;
    }
    this.hp -= amount;
    this.world.fx.hitFlash(this);
    if (this.hp <= 0) this.die();
  }

  /** Line of sight: fade the enemy and everything attached to it. */
  setSeenAlpha(a: number) {
    this.setAlpha(a);
    this.shadowImg.setAlpha(a);
    for (const o of this.attachments()) o.setAlpha(a);
  }

  /** Hides the shadow and attached parts (turret, gun), and the body too unless keepBody. */
  hideParts(keepBody = false) {
    if (!keepBody) this.setVisible(false);
    this.shadowImg.setVisible(false);
    for (const o of this.attachments()) o.setVisible(false);
  }

  protected attachments(): Phaser.GameObjects.Image[] {
    return [];
  }

  protected die() {
    this.world.onEnemyKilled(this);
    this.destroy();
  }

  destroy(fromScene?: boolean) {
    this.shadowImg?.destroy();
    super.destroy(fromScene);
  }

  protected distanceTo(p: Phaser.Math.Vector2) {
    return Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y);
  }

  protected angleTo(p: Phaser.Math.Vector2) {
    return Phaser.Math.Angle.Between(this.x, this.y, p.x, p.y);
  }
}

// s1: mummy. Shambles toward the player, stops at a distance, shoots aimed bullets.
export class Rifleman extends Enemy {
  readonly score = ENEMIES.s1.score;
  private strafe = Math.random() < 0.5 ? -1 : 1;

  constructor(world: GameScene, x: number, y: number) {
    super(world, x, y, "mummy", ENEMIES.s1.hp, 0.75);
    this.body.setCircle(15, this.width / 2 - 15, this.height / 2 - 15);
  }

  think(time: number, player: Phaser.Math.Vector2) {
    const cfg = ENEMIES.s1;
    const a = this.angleTo(player);
    this.setRotation(a);
    const d = this.distanceTo(player);
    if (d > cfg.stopDistance) {
      this.body.setVelocity(Math.cos(a) * cfg.speed, Math.sin(a) * cfg.speed);
    } else {
      // side-step while in range
      this.body.setVelocity(Math.cos(a + Math.PI / 2) * cfg.speed * 0.5 * this.strafe, Math.sin(a + Math.PI / 2) * cfg.speed * 0.5 * this.strafe);
      if (Math.random() < 0.01) this.strafe *= -1;
    }
    if (d < cfg.range && time > this.nextShot) {
      this.nextShot = time + cfg.fireInterval + Phaser.Math.Between(-400, 400);
      const tip = { x: this.x + Math.cos(a) * 30 - Math.sin(a) * 10, y: this.y + Math.sin(a) * 30 + Math.cos(a) * 10 };
      this.world.fireBullet("enemy", tip.x, tip.y, a, cfg.bulletSpeed, cfg.range);
      this.world.fx.muzzle(tip.x, tip.y, a, 0.8);
    }
  }
}

// s2: mummy priest. Keeps its distance and lobs fire pots over cover.
export class Grenadier extends Enemy {
  readonly score = ENEMIES.s2.score;

  constructor(world: GameScene, x: number, y: number) {
    super(world, x, y, "mummy_priest", ENEMIES.s2.hp, 0.75);
    this.body.setCircle(15, this.width / 2 - 15, this.height / 2 - 15);
  }

  think(time: number, player: Phaser.Math.Vector2) {
    const cfg = ENEMIES.s2;
    const a = this.angleTo(player);
    this.setRotation(a);
    const d = this.distanceTo(player);
    const dir = d < cfg.minDistance ? -1 : d > cfg.maxDistance ? 1 : 0;
    this.body.setVelocity(Math.cos(a) * cfg.speed * dir, Math.sin(a) * cfg.speed * dir);
    if (d < cfg.maxDistance + TILE && time > this.nextShot) {
      this.nextShot = time + cfg.fireInterval + Phaser.Math.Between(-500, 500);
      const miss = 30;
      this.world.lobGrenade("enemy", this.x, this.y, player.x + Phaser.Math.Between(-miss, miss), player.y + Phaser.Math.Between(-miss, miss));
    }
  }
}

// t1: stone sphinx. Prowls along the road toward the player; its head turns to track you and spits cat bombs.
export class Tank extends Enemy {
  readonly score = ENEMIES.t1.score;
  private turret: Phaser.GameObjects.Image;
  private lastTrack = new Phaser.Math.Vector2();

  constructor(world: GameScene, x: number, y: number) {
    super(world, x, y, "sphinx", ENEMIES.t1.hp, 2.2);
    this.armored = true;
    this.setScale(1.2).setRotation(Math.PI); // sprite faces up; sphinxes come down the road
    this.body.setSize(this.width * 0.8, this.height * 0.8);
    this.body.setImmovable(true);
    this.turret = world.add.image(x, y, "sphinx_head").setScale(1.2).setDepth(DEPTH.units + 1); // the head
    this.lastTrack.set(x, y);
  }

  think(time: number, player: Phaser.Math.Vector2) {
    const cfg = ENEMIES.t1;
    const dy = player.y - this.y;
    const ahead = this.y + Math.sign(dy) * TILE * 1.1;
    const canMove = Math.abs(dy) > cfg.stopDistance && this.world.isRoadAt(this.x - TILE / 2, ahead) && this.world.isRoadAt(this.x + TILE / 2, ahead);
    this.body.setVelocity(0, canMove ? Math.sign(dy) * cfg.speed : 0);
    this.setRotation(dy >= 0 ? Math.PI : 0);

    const a = this.angleTo(player);
    // the head sits at the front of the body (the sprite faces up, so front = rotation's "up")
    const fx = Math.sin(this.rotation), fy = -Math.cos(this.rotation);
    this.turret.setPosition(this.x + fx * 40, this.y + fy * 40).setRotation(a - Math.PI / 2);

    if (Phaser.Math.Distance.Between(this.x, this.y, this.lastTrack.x, this.lastTrack.y) > 24) {
      this.world.dropTrackDecal(this.x, this.y, this.rotation);
      this.lastTrack.set(this.x, this.y);
    }
    if (this.distanceTo(player) < cfg.range && time > this.nextShot) {
      this.nextShot = time + cfg.fireInterval + Phaser.Math.Between(-500, 500);
      const tip = { x: this.turret.x + Math.cos(a) * 28, y: this.turret.y + Math.sin(a) * 28 };
      this.world.fireShell(tip.x, tip.y, a, cfg.bulletSpeed, cfg.range);
      this.world.fx.dust(tip.x, tip.y);
      this.world.cameras.main.shake(80, 0.002);
    }
  }

  protected attachments() {
    return [this.turret];
  }

  protected die() {
    this.world.fx.explosion(this.x, this.y, 2);
    this.world.leaveWreck(this.x, this.y, this.rotation, "tank");
    super.die();
  }

  destroy(fromScene?: boolean) {
    this.turret?.destroy();
    super.destroy(fromScene);
  }
}

// b1: guardian sphinx. Static; its head sweeps a 90° arc facing down and spits cursed bolts often.
export class Bunker extends Enemy {
  readonly score = ENEMIES.b1.score;
  private gun: Phaser.GameObjects.Image;

  constructor(world: GameScene, x: number, y: number) {
    super(world, x, y, "sphinx", ENEMIES.b1.hp, 1.3);
    // a smaller seated sphinx guarding its post, facing down the map (the sprite faces up)
    this.setScale(0.75).setRotation(Math.PI).setDepth(DEPTH.obstacles).setTint(0xe8d8b0);
    this.armored = true;
    this.body.setSize(this.width * 0.8, this.height * 0.75);
    this.body.setImmovable(true);
    this.gun = world.add.image(x, y + 26, "sphinx_head").setScale(0.8).setDepth(DEPTH.obstacles + 1); // the head turns and spits
    this.shadowImg.setDepth(DEPTH.objShadow);
  }

  think(time: number, player: Phaser.Math.Vector2) {
    const cfg = ENEMIES.b1;
    const down = Math.PI / 2;
    const half = Phaser.Math.DegToRad(cfg.arcDeg / 2);
    const a = Phaser.Math.Clamp(this.angleTo(player), down - half, down + half);
    this.gun.setRotation(a - Math.PI / 2);
    const inArc = Math.abs(Phaser.Math.Angle.Wrap(this.angleTo(player) - down)) <= half;
    if (inArc && this.distanceTo(player) < cfg.range && time > this.nextShot) {
      this.nextShot = time + cfg.fireInterval;
      const tip = { x: this.gun.x + Math.cos(a) * 18, y: this.gun.y + Math.sin(a) * 18 };
      this.world.fireBullet("enemy", tip.x, tip.y, a, cfg.bulletSpeed, cfg.range);
      this.world.fx.muzzle(tip.x, tip.y, a, 0.8);
    }
  }

  protected attachments() {
    return [this.gun];
  }

  protected die() {
    this.world.fx.explosion(this.x, this.y, 1.5);
    this.world.leaveWreck(this.x, this.y, 0, "bunker");
    super.die();
  }

  destroy(fromScene?: boolean) {
    this.gun?.destroy();
    super.destroy(fromScene);
  }
}

// k1: the Pharaoh's chariot. Races across the temple courtyard firing arrow volleys;
// below half health it speeds up, widens the volley and lobs fire pots. Running into it hurts.
export class Chariot extends Enemy {
  readonly score = ENEMIES.k1.score;
  readonly maxHp = ENEMIES.k1.hp;
  private dir = 1;
  private nextPot = 0;
  private nextDust = 0;
  private announced = false;

  constructor(world: GameScene, x: number, y: number) {
    super(world, x, y, "chariot", ENEMIES.k1.hp, 2.6);
    this.setScale(1.3);
    this.body.setSize(140, 50); // scaled with the sprite; stays clear of the statues below its row
    this.body.setImmovable(true);
    this.shadowImg.setScale(4, 2);
  }

  get enraged() {
    return this.hp <= this.maxHp / 2;
  }

  think(time: number, player: Phaser.Math.Vector2) {
    const cfg = ENEMIES.k1;
    if (!this.announced) {
      this.announced = true;
      this.world.bossAppeared(this);
    }
    if (this.x > cfg.maxX) this.dir = -1;
    if (this.x < cfg.minX) this.dir = 1;
    this.body.setVelocity(this.dir * (this.enraged ? cfg.rageSpeed : cfg.speed), 0);
    this.setFlipX(this.dir < 0);
    if (time > this.nextDust) {
      this.nextDust = time + 90;
      this.world.fx.dust(this.x - this.dir * 50, this.y + Phaser.Math.Between(-30, 30));
    }
    if (this.distanceTo(player) < 70) this.world.trample();

    if (this.distanceTo(player) < cfg.range && time > this.nextShot) {
      this.nextShot = time + (this.enraged ? cfg.rageFireInterval : cfg.fireInterval);
      const a = this.angleTo(player);
      const n = this.enraged ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const spread = (i - (n - 1) / 2) * 0.18;
        this.world.fireBullet("enemy", this.x, this.y + 10, a + spread, cfg.bulletSpeed, cfg.range);
      }
    }
    if (this.enraged && time > this.nextPot && time > this.blindUntil) {
      this.nextPot = time + cfg.potInterval;
      this.world.lobGrenade("enemy", this.x, this.y, player.x + Phaser.Math.Between(-40, 40), player.y + Phaser.Math.Between(-40, 40));
    }
  }

  damage(amount: number, fromBullet: boolean) {
    const wasEnraged = this.enraged;
    super.damage(amount, fromBullet);
    if (!this.active) return; // died: the scene clears the boss bar
    this.world.registry.set("boss", { name: ENEMIES.k1.name, hp: this.hp, max: this.maxHp });
    if (!wasEnraged && this.enraged) this.world.fx.floatingText(this.x, this.y - 60, "THE PHARAOH IS ENRAGED!", "#ff7a5a");
  }

  protected die() {
    this.world.fx.explosion(this.x - 40, this.y, 1.6);
    this.world.fx.explosion(this.x + 40, this.y, 1.6);
    this.world.leaveWreck(this.x, this.y, 0, "tank");
    super.die();
  }
}

export function createEnemy(code: string, world: GameScene, x: number, y: number): Enemy | null {
  switch (code) {
    case "s1": return new Rifleman(world, x, y);
    case "s2": return new Grenadier(world, x, y);
    case "t1": return new Tank(world, x, y);
    case "b1": return new Bunker(world, x, y);
    case "k1": return new Chariot(world, x, y);
    default: return null;
  }
}
