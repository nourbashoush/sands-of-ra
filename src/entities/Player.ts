import Phaser from "phaser";
import { PLAYER } from "../config";
import { DEPTH } from "../fx";
import type { GameScene } from "../scenes/GameScene";
import { touch } from "../touch";

export class Player extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  private shadowImg: Phaser.GameObjects.Image;
  private keys: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d" | "space", Phaser.Input.Keyboard.Key>;
  private lastShot = 0;
  invulnerableUntil = 0;
  alive = true;

  constructor(private world: GameScene, x: number, y: number) {
    super(world, x, y, "pharaoh");
    world.add.existing(this);
    world.physics.add.existing(this);
    this.setDepth(DEPTH.units);
    this.body.setCircle(15, this.width / 2 - 15, this.height / 2 - 15);
    this.body.setCollideWorldBounds(true);
    this.shadowImg = world.fx.shadow(0.8);

    const kb = world.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = kb.addKeys({
      up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT,
      w: K.W, a: K.A, s: K.S, d: K.D, space: K.SPACE,
    }) as Player["keys"];
    this.keys.space.on("down", () => this.throwGrenade());
    world.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) this.throwGrenade();
    });
    world.input.mouse?.disableContextMenu();
    touch.storm = () => this.throwGrenade();
  }

  update(time: number) {
    this.shadowImg.setPosition(this.x + 4, this.y + 6).setVisible(this.visible);
    if (!this.alive) return;

    const k = this.keys;
    const vx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    const vy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
    const v = touch.on && (vx || vy) === 0
      ? new Phaser.Math.Vector2(touch.move.x, touch.move.y).limit(1).scale(PLAYER.speed) // the left stick: push further, go faster
      : new Phaser.Math.Vector2(vx, vy).normalize().scale(PLAYER.speed);
    this.body.setVelocity(v.x, v.y);

    let aim: number, firing: boolean;
    if (touch.on) {
      // the right stick aims; with it untouched, face the way you're walking
      const stick = touch.aim.x || touch.aim.y ? touch.aim : v.lengthSq() > 100 ? v : null;
      aim = stick ? Math.atan2(stick.y, stick.x) : this.rotation;
      firing = touch.firing;
    } else {
      const p = this.world.input.activePointer;
      aim = Phaser.Math.Angle.Between(this.x, this.y, p.worldX, p.worldY);
      firing = p.leftButtonDown();
    }
    this.setRotation(aim);

    if (firing && time - this.lastShot > PLAYER.fireInterval) {
      this.lastShot = time;
      const muzzle = this.gunTip();
      const angle = aim + Phaser.Math.FloatBetween(-PLAYER.bulletSpread, PLAYER.bulletSpread);
      this.world.fireBullet("player", muzzle.x, muzzle.y, angle, PLAYER.bulletSpeed, PLAYER.bulletRange);
      this.world.fx.muzzle(muzzle.x, muzzle.y, aim);
    }

    // blink while invulnerable (not under a god's shield: that has its own bubble)
    this.setAlpha(time < this.invulnerableUntil && time > this.world.shieldUntil ? (Math.floor(time / 90) % 2 ? 0.35 : 1) : 1);
  }

  gunTip() {
    // the gun sits right of centre, a bit below the aim axis
    const fwd = 30, side = 10;
    const c = Math.cos(this.rotation), s = Math.sin(this.rotation);
    return { x: this.x + c * fwd - s * side, y: this.y + s * fwd + c * side };
  }

  private throwGrenade() {
    if (!this.alive || this.world.grenades <= 0 || this.world.cinematic) return;
    const p = this.world.input.activePointer;
    const target = touch.on
      ? new Phaser.Math.Vector2(Math.cos(this.rotation), Math.sin(this.rotation)).scale(PLAYER.grenadeRange) // as far as it goes, the way you face
      : new Phaser.Math.Vector2(p.worldX - this.x, p.worldY - this.y).limit(PLAYER.grenadeRange);
    this.world.setGrenades(this.world.grenades - 1);
    this.world.lobGrenade("player", this.x, this.y, this.x + target.x, this.y + target.y);
  }

  destroy(fromScene?: boolean) {
    this.shadowImg?.destroy();
    super.destroy(fromScene);
  }
}
