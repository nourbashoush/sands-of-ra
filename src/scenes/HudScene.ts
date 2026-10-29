import Phaser from "phaser";
import { CARTOUCHES, FRAME, GAME_TITLE, RES, STAT_BAR, VIEW_H, VIEW_W } from "../config";
import type { Level } from "../levelFormat";
import { freshLevel } from "../freshLevel";
import { closeMenu, openMenu } from "../menu";
import { touch } from "../touch";
import { settings } from "../settings";
import { audio } from "../audio";
import { FONT } from "../style";
import { makeFrame } from "../art";

type Boss = { name: string; hp: number; max: number } | null;
type Hud = { score: number; lives: number; grenades: number; pows: number; powsTotal: number; cats: number; catsTotal: number };

const INK = "#f4f1ea";
const YELLOW = "#ffd23f";
const BAND_FONT = FONT;

// The flat indigo frame: stats in pills along the top band, the level name (or the Pharaoh's
// health) in the bottom band, plus the start, pause and end cards.
export class HudScene extends Phaser.Scene {
  private stats!: Record<keyof typeof CARTOUCHES, Phaser.GameObjects.Text>;
  private bandName!: Phaser.GameObjects.Text;
  private namePill!: Phaser.GameObjects.Graphics;
  private bossBar!: Phaser.GameObjects.Container;
  private bossFill!: Phaser.GameObjects.Graphics;
  private currentBanner?: Phaser.GameObjects.Container;
  private errorPlaque?: Phaser.GameObjects.Container;
  private frame!: Phaser.GameObjects.Image;
  private paused = false;
  private ended = false;

  constructor() {
    super("hud");
  }

  create(data?: { quiet?: boolean }) {
    const LEVEL_NAME = (this.registry.get("level") as Level).name;
    this.cameras.main.setZoom(RES).setOrigin(0, 0);
    this.frame = this.add.image(0, 0, "tomb_frame").setOrigin(0).setScale(1 / RES); // drawn at full resolution
    const carved = (x: number, y: number, size: number) =>
      this.add.text(x, y, "", { fontFamily: BAND_FONT, fontSize: `${size}px`, fontStyle: "bold", color: INK })
        .setOrigin(0.5).setShadow(0, 1.5, "rgba(17,20,58,0.6)", 0).setResolution(RES);
    const midY = STAT_BAR.y + STAT_BAR.h / 2;
    this.stats = {
      score: carved(0, midY, 17),
      lives: carved(0, midY, 19).setColor(YELLOW),
      storms: carved(0, midY, 17),
      pows: carved(0, midY, 17),
      cats: carved(0, midY, 17),
    };
    for (const key of Object.keys(CARTOUCHES) as (keyof typeof CARTOUCHES)[]) {
      const [x, w] = CARTOUCHES[key];
      this.stats[key].setX(x + w / 2 - STAT_BAR.h / 4); // centred left of the knot bar
    }
    this.namePill = this.add.graphics()
      .fillStyle(0x11143a, 0.35).fillRoundedRect(VIEW_W / 2 - 150 + 2, 4, 300, 30, 15)
      .fillStyle(0x11143a, 0.85).fillRoundedRect(VIEW_W / 2 - 150, 0, 300, 30, 15);
    this.bandName = carved(VIEW_W / 2, 0, 17).setText(`· ${LEVEL_NAME.toUpperCase()} ·`).setColor(YELLOW);

    this.refresh(this.registry.get("hud"));
    this.makeBossBar();
    this.placeBottom();
    this.showLevelError(this.registry.get("levelError"));
    const onChange = (_p: unknown, key: string, value: Hud & Boss) => {
      if (key === "hud") this.refresh(value);
      if (key === "boss") this.refreshBoss(value);
      if (key === "levelError") this.showLevelError(value as unknown as string[] | null);
    };
    this.registry.events.on("changedata", onChange);
    this.events.once("shutdown", () => this.registry.events.off("changedata", onChange));

    const game = this.scene.get("game");
    game.events.once("gameover", (r: { won: boolean; score: number }) => this.showEnd(r.won, r.score));

    // pause: P or Esc toggles; R restarts from the pause screen; leaving the window pauses too.
    // Handled here because the HUD keeps running while the game scene is paused.
    this.paused = false;
    this.ended = false;
    const kb = this.input.keyboard!;
    kb.on("keydown-P", () => this.togglePause());
    touch.pause = () => this.togglePause();
    kb.on("keydown-ESC", () => this.togglePause());
    kb.on("keydown-R", () => { if (this.paused) this.newGame(); }); // after a game ends, GameScene handles R itself
    closeMenu(); // a new game: no menu left over
    const onBlur = () => { if (!this.paused && settings.pauseOnBlur) this.togglePause(); };
    this.game.events.on(Phaser.Core.Events.BLUR, onBlur);
    this.events.once("shutdown", () => this.game.events.off(Phaser.Core.Events.BLUR, onBlur));
    game.events.once("shutdown", () => this.scene.stop());
    game.events.once("boss", () => this.banner("PHARAOH", "his chariot guards the temple gate", 1800));

    // game first, then the level: "SANDS OF RA" / "LEVEL 1 · CROSSING THE NILE"
    if (!data?.quiet) this.banner(GAME_TITLE.toUpperCase(), touch.on ? "left stick move · right stick aim and fire · STORM · GODS" : "WASD move · mouse aim · click fire · SPACE sandstorm · E summon the gods · P pause", 1800, `LEVEL 1  ·  ${LEVEL_NAME.toUpperCase()}`);
  }

  private refresh(h?: Hud) {
    if (!h) return;
    this.stats.score.setText(`SCORE ${String(h.score).padStart(6, "0")}`);
    this.stats.lives.setText(h.lives > 0 ? "☥ ".repeat(h.lives).trim() : "—");
    this.stats.storms.setText(`SANDSTORMS ${h.grenades}`);
    this.stats.pows.setText(`RESCUED ${h.pows}/${h.powsTotal}`); // captives freed (they shout "HELP!")
    this.stats.cats.setText(`CATS ${h.cats}`); // your army: no "out of", there is no ceiling
  }

  private togglePause() {
    if (this.ended || this.registry.get("timeStopped")) return; // the council of the gods holds time still
    const game = this.scene.get("game");
    this.paused = !this.paused;
    audio.play(this.paused ? "pause" : "resume");
    audio.setPaused(this.paused); // the music stops while paused
    if (this.paused) {
      game.scene.pause();
      this.currentBanner?.destroy();
      openMenu(this.game, { title: "PAUSED", subtitle: "Time waits for you, pharaoh.", onResume: () => this.togglePause(), onNewGame: () => this.newGame() });
    } else {
      game.scene.resume();
      closeMenu();
    }
  }

  /** A fresh game: the level file as it is on disk, a new run from the bottom. */
  private newGame() {
    this.paused = false;
    audio.setPaused(false);
    closeMenu();
    const game = this.scene.get("game");
    void freshLevel(this.registry).then(() => game.scene.restart({})); // {}: not the last { resume } (Phaser keeps old data)
  }

  /** A broken level file: the errors in red at the top of the field; the last good level keeps running. */
  private showLevelError(errors: string[] | null) {
    this.errorPlaque?.destroy();
    this.errorPlaque = undefined;
    if (!errors?.length) return;
    const lines = errors.slice(0, 5);
    if (errors.length > 5) lines.push(`… and ${errors.length - 5} more`);
    const t = this.add.text(0, 0, ["LEVEL FILE NOT LOADED (still playing the last good one)", ...lines].join("\n"), {
      fontFamily: "Menlo, monospace", fontSize: "13px", color: "#fff", lineSpacing: 3,
      wordWrap: { width: VIEW_W - 2 * FRAME.side - 40 },
    }).setResolution(RES);
    const bg = this.add.graphics()
      .fillStyle(0x11143a, 0.5).fillRoundedRect(-10, -5, t.width + 20, t.height + 16, 10)
      .fillStyle(0xe84855, 0.95).fillRoundedRect(-10, -8, t.width + 20, t.height + 16, 10);
    this.errorPlaque = this.add.container(FRAME.side + 10, FRAME.top + 14, [bg, t]).setDepth(10);
  }

  /** The Pharaoh's health, set into the bottom band in place of the level name. */
  private makeBossBar() {
    const w = 420;
    const label = this.add.text(-w / 2 - 14, 0, "PHARAOH", { fontFamily: BAND_FONT, fontSize: "20px", fontStyle: "bold", color: YELLOW })
      .setOrigin(1, 0.5).setShadow(0, 1.5, "rgba(17,20,58,0.6)", 0).setResolution(RES);
    const groove = this.add.graphics().fillStyle(0x11143a, 0.85).fillRoundedRect(-w / 2 - 130, -17, w + 145, 34, 17).fillStyle(0x11143a).fillRoundedRect(-w / 2 - 5, -10, w + 10, 20, 10);
    // the fill is drawn from x = 0 so scaleX shrinks it towards the left end
    this.bossFill = this.add.graphics({ x: -w / 2 })
      .fillStyle(0xb8324a).fillRoundedRect(0, -6, w, 12, 6)
      .fillStyle(0xff5e7e).fillRoundedRect(0, -6, w, 8, { tl: 6, tr: 6, bl: 3, br: 3 });
    this.bossBar = this.add.container(VIEW_W / 2 + 50, 0, [label, groove, this.bossFill]).setVisible(false);
  }

  /** The level name and the Pharaoh's health sit on the bottom edge, wherever that is. */
  private placeBottom() {
    this.namePill.y = VIEW_H - 42;
    this.bandName.y = VIEW_H - 27;
    this.bossBar.y = VIEW_H - 27;
  }

  /** The phone turned: refit the HUD to the new VIEW_H and RES. */
  refit() {
    this.cameras.main.setZoom(RES);
    makeFrame(this); // the stat pills, redrawn at the new resolution
    this.frame.setTexture("tomb_frame").setScale(1 / RES);
    this.placeBottom();
    this.currentBanner?.setPosition(VIEW_W / 2, VIEW_H / 2 - 40);
    const sharpen = (list: Phaser.GameObjects.GameObject[]): void => list.forEach((o) => {
      if (o instanceof Phaser.GameObjects.Text) o.setResolution(RES);
      else if (o instanceof Phaser.GameObjects.Container) sharpen(o.list);
    });
    sharpen(this.children.list);
  }

  private refreshBoss(b: Boss) {
    const show = !!b && b.hp > 0;
    this.bossBar.setVisible(show);
    this.bandName.setVisible(!show);
    this.namePill.setVisible(!show);
    if (b) this.bossFill.scaleX = b.hp / b.max;
  }

  /** A flat card in the middle of the screen: indigo, rounded, with a coloured accent strip. */
  private banner(title: string, sub: string, ms?: number, kicker?: string) {
    this.currentBanner?.destroy();
    const c = this.add.container(VIEW_W / 2, VIEW_H / 2 - 40);
    this.currentBanner = c;
    const t = this.add.text(0, -4, title, { fontFamily: BAND_FONT, fontSize: "52px", fontStyle: "bold", color: YELLOW })
      .setOrigin(0.5).setShadow(0, 3, "rgba(17,20,58,0.8)", 0).setResolution(RES);
    const s = this.add.text(0, kicker ? 74 : 46, sub, { fontFamily: BAND_FONT, fontSize: "17px", color: "#c9c3e0" }).setOrigin(0.5).setResolution(RES);
    const k = kicker ? this.add.text(0, 42, kicker, { fontFamily: BAND_FONT, fontSize: "18px", fontStyle: "bold", color: "#ff9db0" }).setOrigin(0.5).setResolution(RES) : null;
    const w = Math.max(t.width, s.width) + 80, h = kicker ? 168 : 140, x = -w / 2, y = (kicker ? 28 : 14) - h / 2, r = 22;
    const card = this.add.graphics()
      .fillStyle(0x11143a, 0.45).fillRoundedRect(x + 6, y + 10, w, h, r) // soft cast shadow
      .fillStyle(0x1b1f4b).fillRoundedRect(x, y, w, h, r)
      .fillStyle(0x3a2d6b, 0.6).fillRoundedRect(x, y, w, h * 0.45, { tl: r, tr: r, bl: 0, br: 0 }) // lit upper half
      .fillStyle(0xff5e7e).fillRoundedRect(x + w / 2 - 60, y + 12, 120, 6, 3) // accent strip
      .fillStyle(0xffd23f).fillCircle(x + w / 2 - 76, y + 15, 3).fillCircle(x + w / 2 + 76, y + 15, 3);
    c.add([card, t, s, ...(k ? [k] : [])]);
    if (ms) this.tweens.add({ targets: c, alpha: 0, delay: ms, duration: 300, onComplete: () => c.destroy() });
  }

  private showEnd(won: boolean, score: number) {
    this.ended = true;
    openMenu(this.game, {
      title: won ? "THE GODS ARE PLEASED" : "LOST TO THE SANDS",
      subtitle: `Score ${String(score).padStart(6, "0")}`,
      onNewGame: () => this.newGame(),
    });
  }

}
