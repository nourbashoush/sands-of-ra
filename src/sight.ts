import Phaser from "phaser";
import { DEPTH } from "./fx";

// Line of sight, Among Us style: rays from the player stop at walls, pyramids and stone
// landmarks. Whatever they don't reach is dimmed, and things in it can be hidden.

type Seg = { ax: number; ay: number; bx: number; by: number };

const DIM = 0.62; // darkness of the unseen area
const EPS = 0.0005; // rays either side of each corner, to see past it

export class LineOfSight {
  private occluders: Phaser.Geom.Rectangle[] = [];
  private segs: Seg[] = [];
  private poly: Phaser.Math.Vector2[] = [];
  private shade: Phaser.GameObjects.Graphics;
  private cover: Phaser.GameObjects.Graphics;
  private origin = new Phaser.Math.Vector2();

  constructor(scene: Phaser.Scene) {
    // Darkness is drawn as shapes (no masks: they misplace under the high-DPI camera zoom).
    // Shadow wedges fan out behind the edge of what the player sees; walls and monuments are
    // drawn above them (DEPTH.litWalls), and the ones the player can't see get their own cover.
    this.shade = scene.add.graphics().setDepth(DEPTH.sight);
    this.cover = scene.add.graphics().setDepth(DEPTH.wallCover);
  }

  /** Creative mode sees everything: no darkness, no wall covers. */
  setVisible(on: boolean) {
    this.shade.setVisible(on);
    this.cover.setVisible(on);
  }

  addOccluder(x: number, y: number, w: number, h: number) {
    this.occluders.push(new Phaser.Geom.Rectangle(x, y, w, h));
  }

  /** Recompute what the player at (px, py) can see inside the camera's view. */
  update(px: number, py: number, view: Phaser.Geom.Rectangle) {
    this.origin.set(px, py);

    // segments: every occluder edge near the view, plus the view's own border
    const near = new Phaser.Geom.Rectangle(view.x - 64, view.y - 64, view.width + 128, view.height + 128);
    const segs: Seg[] = [];
    const corners: { x: number; y: number }[] = [];
    const addRect = (r: Phaser.Geom.Rectangle) => {
      const pts = [{ x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.right, y: r.bottom }, { x: r.left, y: r.bottom }];
      for (let i = 0; i < 4; i++) {
        const a = pts[i], b = pts[(i + 1) % 4];
        segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
        corners.push(a);
      }
    };
    for (const r of this.occluders) if (Phaser.Geom.Intersects.RectangleToRectangle(r, near)) addRect(r);
    addRect(near);
    this.segs = segs;

    // one ray at each corner and just either side of it, plus a fan to keep the outline smooth
    const angles: number[] = [];
    for (const c of corners) {
      const a = Math.atan2(c.y - py, c.x - px);
      angles.push(a - EPS, a, a + EPS);
    }
    for (let i = 0; i < 64; i++) angles.push((i / 64) * Math.PI * 2 - Math.PI);
    angles.sort((a, b) => a - b);

    this.poly = [];
    for (const a of angles) {
      const t = this.cast(px, py, Math.cos(a), Math.sin(a));
      if (t < Infinity) this.poly.push(new Phaser.Math.Vector2(px + Math.cos(a) * t, py + Math.sin(a) * t));
    }
    // shadow wedges: from each edge of the visible area straight away from the player, far off-screen
    const far = 4000;
    this.shade.clear().fillStyle(0x11143a, DIM);
    for (let i = 0; i < this.poly.length; i++) {
      const a = this.poly[i], b = this.poly[(i + 1) % this.poly.length];
      const fa = this.away(a, far), fb = this.away(b, far);
      this.shade.fillPoints([a, b, fb, fa], true);
    }
    // walls and monuments you can see stay readable, like in Among Us; ones hidden behind them are dimmed
    this.cover.clear().fillStyle(0x11143a, DIM);
    for (const r of this.occluders) {
      if (Phaser.Geom.Intersects.RectangleToRectangle(r, near) && !this.faceVisible(r)) this.cover.fillRectShape(r);
    }
  }

  private away(p: Phaser.Math.Vector2, dist: number) {
    const dx = p.x - this.origin.x, dy = p.y - this.origin.y, len = Math.hypot(dx, dy) || 1;
    return new Phaser.Math.Vector2(p.x + (dx / len) * dist, p.y + (dy / len) * dist);
  }

  /** True if nothing blocks the straight line from the player to (x, y). */
  canSee(x: number, y: number) {
    const dx = x - this.origin.x, dy = y - this.origin.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return true;
    return this.cast(this.origin.x, this.origin.y, dx / len, dy / len) >= len - 2;
  }

  /** True if any edge of the rectangle (sampled just outside it) is in the player's line of sight. */
  private faceVisible(r: Phaser.Geom.Rectangle) {
    const o = 2;
    const pts = [
      [r.left - o, r.top - o], [r.centerX, r.top - o], [r.right + o, r.top - o],
      [r.right + o, r.centerY], [r.right + o, r.bottom + o], [r.centerX, r.bottom + o],
      [r.left - o, r.bottom + o], [r.left - o, r.centerY],
    ];
    return pts.some(([x, y]) => this.canSee(x, y));
  }

  /** Distance along the ray (ox, oy) + t·(dx, dy) to the nearest segment. */
  private cast(ox: number, oy: number, dx: number, dy: number) {
    let best = Infinity;
    for (const s of this.segs) {
      const ex = s.bx - s.ax, ey = s.by - s.ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((s.ax - ox) * ey - (s.ay - oy) * ex) / den;
      const u = ((s.ax - ox) * dy - (s.ay - oy) * dx) / den;
      if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
    }
    return best;
  }
}
