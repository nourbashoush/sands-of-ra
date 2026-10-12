import Phaser from "phaser";
import { makeEgyptArt } from "../art";
import { TILE } from "../config";

// Loads the remaining Kenney sprites and generates the textures we draw in code (flat Kurzgesagt-like style).
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  preload() {
    this.load.setPath("assets/");
    this.load.spritesheet("tiles", "tiles.png", { frameWidth: TILE, frameHeight: TILE });
    for (const key of [
      "player", "rifleman", "grenadier", "tank", "tank_barrel", "bunker_barrel",
      "tree_large", "tree_small", "barrel_red", "bullet_player", "shell",
    ]) {
      this.load.image(key, `${key}.png`);
    }
    // pow, sandbag, bullet_enemy, scorch, tracks, crate and the smoke_* puffs are drawn in art.ts
  }

  create() {
    this.makeRadial("shadow", 64, 0x11143a, 0.5); // soft indigo, never black
    this.makeRadial("flash", 64, 0xfff2b0, 1);
    this.makeRadial("spark", 8, 0xfff0d0, 1);
    this.makeRadial("glow", 32, 0xffffff, 0.6);
    this.makeVignette();
    this.makeExtrudedTileset();
    makeEgyptArt(this);

    // flat, three-tone: shade, base, highlight
    const g = this.make.graphics({}, false);
    g.fillStyle(0x11143a).fillCircle(8, 8, 7).fillStyle(0x3a2d6b).fillCircle(7, 7, 6).fillStyle(0x6c5ce7).fillCircle(5.5, 5.5, 2.2);
    g.fillStyle(0xff5e7e).fillRect(2, 7, 12, 2);
    g.generateTexture("grenade", 16, 16);
    g.clear();
    g.fillStyle(0x8f4a2a).fillRoundedRect(2, 6, 28, 20, 6).fillStyle(0xc8733a).fillRoundedRect(2, 6, 26, 18, 6);
    g.fillStyle(0xffd23f).fillRoundedRect(6, 12, 20, 7, 3.5);
    g.generateTexture("grenade_box", 32, 32);
    g.destroy();

    this.scene.start("game");
  }

  // Copy of the tilesheet with every tile's edge pixels repeated 1px outwards,
  // so linear filtering at non-integer zoom doesn't show seams between tiles.
  private makeExtrudedTileset() {
    const src = this.textures.get("tiles").getSourceImage() as HTMLImageElement;
    const cols = Math.floor(src.width / TILE), rows = Math.floor(src.height / TILE), cell = TILE + 2;
    const tex = this.textures.createCanvas("tiles_extruded", cols * cell, rows * cell)!;
    const ctx = tex.getContext();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sx = c * TILE, sy = r * TILE, dx = c * cell + 1, dy = r * cell + 1;
        ctx.drawImage(src, sx, sy, TILE, TILE, dx, dy, TILE, TILE);
        ctx.drawImage(src, sx, sy, TILE, 1, dx, dy - 1, TILE, 1); // top
        ctx.drawImage(src, sx, sy + TILE - 1, TILE, 1, dx, dy + TILE, TILE, 1); // bottom
        ctx.drawImage(src, sx, sy, 1, TILE, dx - 1, dy, 1, TILE); // left
        ctx.drawImage(src, sx + TILE - 1, sy, 1, TILE, dx + TILE, dy, 1, TILE); // right
      }
    }
    tex.refresh();
  }

  private makeVignette() {
    const w = 512, h = 384;
    const tex = this.textures.createCanvas("vignette", w, h)!;
    const ctx = tex.getContext();
    const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.4, w / 2, h / 2, w * 0.65);
    grad.addColorStop(0, "rgba(27,31,75,0)");
    grad.addColorStop(0.6, "rgba(27,31,75,0.18)");
    grad.addColorStop(1, "rgba(17,20,58,0.5)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    tex.refresh();
  }

  // Soft round blob: used for shadows, muzzle flashes, sparks.
  private makeRadial(key: string, size: number, color: number, alpha: number) {
    const tex = this.textures.createCanvas(key, size, size)!;
    const ctx = tex.getContext();
    const c = Phaser.Display.Color.IntegerToColor(color);
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${c.red},${c.green},${c.blue},${alpha})`);
    grad.addColorStop(1, `rgba(${c.red},${c.green},${c.blue},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  }
}
