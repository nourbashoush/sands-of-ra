import Phaser from "phaser";
import { DESERT_FRAMES } from "../art";
import { ANKH, BARREL, CATS, CAT_COATS, CRATE_HP, FRAME, RES, GRENADE, GRENADE_PICKUP, PLAYER, POW_SCORE, SANDSTORM, TILE, VIEW_H, VIEW_W } from "../config";
import { Bunker, Chariot, createEnemy, Enemy, Grenadier, Rifleman, Tank } from "../entities/enemies";
import { Player } from "../entities/Player";
import { DEPTH, Fx } from "../fx";
import { LineOfSight } from "../sight";
import type { Grid, Level } from "../levelFormat";
import { ROAD, WALKABLE } from "../rules";
import { freshLevel } from "../freshLevel";
import { difficulty, settings } from "../settings";
import { audio } from "../audio";

type Side = "player" | "enemy";
type Obstacle = Phaser.GameObjects.GameObject & { x: number; y: number; getData(k: string): any; setData(k: string, v: any): any };


/** What the council of the gods sees of the live game (src/council/prompt.ts). Positions in pixels; TILE = 64. */
export type WorldSnapshot = {
  player: { x: number; y: number; row: number; col: number; lives: number; sandstorms: number; score: number; armyCats: number; alive: boolean };
  view: { topRow: number; bottomRow: number };
  rows: number;
  boss: { id: number; x: number; y: number; row: number; hp: number } | null;
  enemies: { id: number; type: string; x: number; y: number; row: number; col: number; hp: number; onScreen: boolean; distance: number }[];
  projectiles: { bullets: number; catBombs: number };
  wildCats: number;
};

export type Resume = { x: number; y: number; viewTop: number; score: number; lives: number; grenades: number; pows: number; cats: number;
  /** Map cells ("row:col") whose unit is already dealt with (killed, sealed, rescued, collected, recruited): not rebuilt. */
  gone: string[] };

export class GameScene extends Phaser.Scene {
  fx!: Fx;
  sight!: LineOfSight;
  player!: Player;
  grenades = 0;

  private terrain!: Grid;
  private units!: Grid;
  private rows = 0;
  private cols = 0;

  private solids!: Phaser.Physics.Arcade.StaticGroup;
  private enemies: Enemy[] = [];
  private clouds: Phaser.GameObjects.Image[] = [];
  private cats: Phaser.GameObjects.Image[] = [];
  private army: Phaser.GameObjects.Image[] = [];
  private trail: { x: number; y: number }[] = [];
  private playerBullets!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;
  private shells!: Phaser.Physics.Arcade.Group;
  private pickups!: Phaser.Physics.Arcade.StaticGroup;
  private groundLayer!: Phaser.Tilemaps.TilemapLayer;
  private wallLayer!: Phaser.Tilemaps.TilemapLayer;

  private score = 0;
  private lives = 0;
  private powsTotal = 0;
  private powsRescued = 0;
  private catsCaught = 0;
  private catsTotal = 0;
  private boss: Chariot | null = null;
  private nextGateWarning = 0;
  private state: "playing" | "dead" | "won" | "over" = "playing";

  constructor() {
    super("game");
  }

  create(data?: { resume?: Resume }) {
    const resume = data?.resume;
    this.enemies = [];
    this.clouds = [];
    this.cats = [];
    this.army = [];
    this.trail = [];
    this.state = "playing";
    const level = this.registry.get("level") as Level;
    this.terrain = level.terrain.map((row) => [...row]); // copies: the game may change cells
    this.units = level.units.map((row) => [...row]);
    this.rows = this.terrain.length;
    this.cols = this.terrain[0].length;
    const worldW = this.cols * TILE, worldH = this.rows * TILE;
    this.physics.world.setBounds(0, 0, worldW, worldH);

    this.fx = new Fx(this);
    this.sight = new LineOfSight(this);
    this.buildTerrain();

    this.playerBullets = this.physics.add.group();
    this.enemyBullets = this.physics.add.group();
    this.shells = this.physics.add.group();
    this.pickups = this.physics.add.staticGroup();

    this.player = new Player(this, resume ? Phaser.Math.Clamp(resume.x, TILE / 2, worldW - TILE / 2) : 8 * TILE, resume ? Math.min(resume.y, worldH - TILE / 2) : worldH - TILE * 1.2);
    this.buildUnits(resume?.gone);
    this.scatterCats();

    // collisions
    for (const blocker of [this.groundLayer, this.wallLayer, this.solids] as Phaser.Types.Physics.Arcade.ArcadeColliderType[]) {
      this.physics.add.collider(this.player, blocker);
      this.physics.add.collider(this.enemies, blocker);
    }
    this.physics.add.collider(this.player, this.enemies.filter((e) => e.body.immovable));
    this.physics.add.overlap(this.playerBullets, this.enemies, (a, b) => {
      const [bullet, enemy] = this.split(this.playerBullets, a, b);
      if (!bullet.active) return;
      this.bulletHit(bullet as Phaser.Physics.Arcade.Image);
      (enemy as Enemy).damage(this.ankhPower(), true);
    });
    for (const group of [this.playerBullets, this.enemyBullets]) {
      this.physics.add.overlap(group, this.solids, (a, b) => {
        const [bullet, o] = this.split(group, a, b);
        this.bulletVsObstacle(bullet as Phaser.Physics.Arcade.Image, o as Obstacle);
      }, (a, b) => (this.split(group, a, b)[1] as Obstacle).getData("kind") !== "tree");
    }
    this.physics.add.overlap(this.enemyBullets, this.player, (a, b) => {
      const [bullet] = this.split(this.enemyBullets, a, b);
      if (!bullet.active) return;
      this.bulletHit(bullet as Phaser.Physics.Arcade.Image);
      this.hurtPlayer();
    });
    for (const target of [this.player, this.solids] as Phaser.Types.Physics.Arcade.ArcadeColliderType[]) {
      this.physics.add.overlap(this.shells, target, (a, b) => {
        this.explodeShell(this.split(this.shells, a, b)[0] as Phaser.Physics.Arcade.Image);
      }, (a, b) => (this.split(this.shells, a, b)[1] as Obstacle).getData?.("kind") !== "tree");
    }
    this.physics.add.overlap(this.player, this.pickups, (_p, item) => this.collect(item as Phaser.Physics.Arcade.Image));

    // camera: only scrolls up, like the arcade original
    const cam = this.cameras.main;
    // draw at full device resolution. The camera zooms about its centre (a top-left origin breaks
    // Phaser's tile culling), so scroll is offset; use viewTop for the top of the visible world.
    cam.setZoom(RES);
    const shake = cam.shake.bind(cam); // the Settings panel can turn screen shake off
    cam.shake = ((...a: Parameters<typeof shake>) => (settings.screenShake ? shake(...a) : cam)) as typeof cam.shake;
    cam.scrollX = -(VIEW_W * (RES - 1)) / 2;
    this.viewTop = resume ? Phaser.Math.Clamp(resume.viewTop, 0, worldH - VIEW_H) : worldH - VIEW_H;
    // colour grade + vignette as screen-space overlays (works on any renderer)
    // Screen-space overlays sit outside the scroll, but the camera still zooms them about its centre:
    // shift them by the zoom's offset or they cover only the top-left quarter of the screen.
    const ox = (VIEW_W * (RES - 1)) / 2, oy = (VIEW_H * (RES - 1)) / 2;
    this.add.rectangle(ox, oy, VIEW_W, VIEW_H, 0xffe2b8).setOrigin(0).setScrollFactor(0).setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(DEPTH.screen);
    this.add.image(ox + VIEW_W / 2, oy + VIEW_H / 2, "vignette").setDisplaySize(VIEW_W, VIEW_H).setScrollFactor(0).setDepth(DEPTH.screen + 1);
    this.fx.desertAir(VIEW_W, VIEW_H);

    this.score = resume?.score ?? 0;
    this.lives = resume?.lives ?? difficulty().lives;
    this.setGrenades(resume?.grenades ?? PLAYER.startGrenades);
    this.powsRescued = resume?.pows ?? 0;
    this.catsCaught = 0;
    // a hot-reloaded level: the cat army comes along, gathered round the player
    for (let i = 0; i < (resume?.cats ?? 0); i++) {
      this.addCat(this.player.x + Phaser.Math.Between(-30, 30), this.player.y + Phaser.Math.Between(10, 50));
      const cat = this.cats[this.cats.length - 1];
      this.army.push(cat);
      this.catsCaught++;
    }
    this.registry.set("boss", null);
    audio.setMood("calm"); // a new game (or a rebuild before the boss): the desert music
    this.syncHud();
    this.scene.launch("hud", { quiet: !!resume });

    // a new game: the level file as on disk, and an EMPTY start (Phaser would otherwise reuse the last { resume })
    this.input.keyboard!.on("keydown-R", () => void freshLevel(this.registry).then(() => this.scene.restart({}))); // a new game: the original map
  }

  // ---------------------------------------------------------------- the council of the gods (src/council/)
  // Gameplay side of the divine powers. The choreography (bolts, portals, tombs rising) is in
  // src/council/powers.ts and calls these at the right moment, on the live objects.

  /** While the gods act: physics and AI hold still, the player can't move or shoot; tweens still run. */
  cinematic = false;
  private slowUntil = 0;
  private slowAmount = 1;
  shieldUntil = 0;
  private revealUntil = 0;

  setCinematic(on: boolean) {
    this.cinematic = on;
    if (on) { this.physics.world.pause(); this.player.body.setVelocity(0, 0); }
    else this.physics.world.resume();
  }

  /** 1 normally; below 1 while Thoth slows time for the player's enemies. */
  slowFactor(time: number) {
    return time < this.slowUntil ? this.slowAmount : 1;
  }

  liveEnemies() {
    return this.enemies.filter((e) => e.active && !e.sealed);
  }

  enemyById(id: number) {
    return this.liveEnemies().find((e) => e.uid === id);
  }

  get bossEnemy() {
    return this.boss?.active ? this.boss : null;
  }

  enemyType(e: Enemy) {
    return e instanceof Chariot ? "pharaoh_chariot" : e instanceof Tank ? "sphinx_tank" : e instanceof Bunker ? "guardian_sphinx"
      : e instanceof Grenadier ? "mummy_priest" : e instanceof Rifleman ? "mummy" : "enemy";
  }

  worldSnapshot(): WorldSnapshot {
    const p = this.player, top = this.viewTop;
    const row = (y: number) => Math.floor(y / TILE);
    const onScreen = (y: number) => y > top - TILE / 2 && y < top + VIEW_H + TILE / 2;
    const enemies = this.liveEnemies().map((e) => ({
      id: e.uid, type: this.enemyType(e), x: Math.round(e.x), y: Math.round(e.y), row: row(e.y), col: Math.floor(e.x / TILE),
      hp: Math.max(0, Math.round(e.hp * 10) / 10), onScreen: onScreen(e.y), distance: Math.round(Phaser.Math.Distance.Between(e.x, e.y, p.x, p.y)),
    })).sort((a, b) => Number(b.onScreen) - Number(a.onScreen) || a.distance - b.distance).slice(0, 30);
    const boss = this.bossEnemy;
    return {
      player: { x: Math.round(p.x), y: Math.round(p.y), row: row(p.y), col: Math.floor(p.x / TILE), lives: this.lives, sandstorms: this.grenades, score: this.score, armyCats: this.army.length, alive: p.alive },
      view: { topRow: row(top + FRAME.top), bottomRow: row(top + VIEW_H - FRAME.bottom - 1) },
      rows: this.rows,
      boss: boss ? { id: boss.uid, x: Math.round(boss.x), y: Math.round(boss.y), row: row(boss.y), hp: Math.round(boss.hp) } : null,
      enemies,
      projectiles: { bullets: this.enemyBullets.countActive(), catBombs: this.shells.countActive() },
      wildCats: this.cats.length - this.army.length,
    };
  }

  /** Smitten: dies as if shot, with score and the usual remains. */
  killEnemy(e: Enemy) {
    if (!e.active) return;
    e.sealed = false;
    e.damage(e.hp + 9999, false);
  }

  /** Gone without a trace (banished, or turned into something else); still scores. */
  removeEnemy(e: Enemy) {
    if (!e.active) return;
    this.markGone(e);
    if (e === this.boss) this.pharaohFallen(e);
    this.addScore(e.score);
    this.fx.floatingText(e.x, e.y - 20, `${e.score}`);
    e.destroy();
  }

  /** Sealed in stone: the enemy stops; the tomb is a wall (blocks movement, bullets and sight). */
  sealEnemy(e: Enemy) {
    if (!e.active) return;
    this.markGone(e);
    e.sealed = true;
    e.body.setVelocity(0, 0);
    e.body.enable = false;
    this.addScore(e.score);
  }

  /** The finished tomb becomes part of the world. */
  addTomb(img: Phaser.GameObjects.Image, size: number) {
    this.physics.add.existing(img, true);
    (img.body as Phaser.Physics.Arcade.StaticBody).setSize(size, size);
    img.setData("kind", "sandbag").setData("hp", 999);
    this.solids.add(img);
    this.sight.addOccluder(img.x - size / 2, img.y - size / 2, size, size);
  }

  /** Mummies become cats that join the army at once. */
  enemyToCat(e: Enemy) {
    const { x, y } = e;
    this.removeEnemy(e);
    return this.spawnArmyCat(x, y);
  }

  spawnArmyCat(x: number, y: number) {
    this.addCat(x, y);
    const cat = this.cats[this.cats.length - 1];
    this.tweens.killTweensOf(cat);
    this.army.push(cat);
    this.catsCaught++;
    this.syncHud();
    return cat;
  }

  /** Where every enemy bullet and cat bomb is right now (the camera aims at them before Purify). */
  projectilePositions() {
    return ([...this.enemyBullets.getChildren(), ...this.shells.getChildren()] as Phaser.Physics.Arcade.Image[]).map((b) => ({ x: b.x, y: b.y }));
  }

  /** Every enemy bullet and cat bomb, removed without exploding. Returns where they were (for the scarabs). */
  clearProjectiles() {
    const spots: { x: number; y: number; bomb: boolean }[] = [];
    for (const group of [this.enemyBullets, this.shells]) {
      for (const b of [...group.getChildren()] as Phaser.Physics.Arcade.Image[]) {
        spots.push({ x: b.x, y: b.y, bomb: group === this.shells });
        b.destroy();
      }
    }
    return spots;
  }

  /** Where "the temple", "the boss" or a row lands the player: the nearest walkable cell near the middle. */
  landingSpot(to: "temple" | "boss" | "start" | number) {
    let row = to === "temple" ? (this.bossEnemy ? Math.floor(this.bossEnemy.y / TILE) + 3 : 1)
      : to === "boss" ? (this.bossEnemy ? Math.floor(this.bossEnemy.y / TILE) + 3 : 3)
      : to === "start" ? this.rows - 2 : Math.floor(to);
    row = Phaser.Math.Clamp(row, 1, this.rows - 2);
    const cols = [7, 8, 6, 9, 5, 10, 4, 11, 3, 12];
    for (let r = row; r < this.rows - 1; r++) {
      const c = cols.find((c) => WALKABLE.has(this.terrain[r][c]));
      if (c !== undefined) return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
    }
    return { x: this.player.x, y: this.player.y };
  }

  /** Moves the player (and the camera with them); enemies right on the landing spot are pushed away. */
  teleportPlayer(x: number, y: number) {
    this.player.setPosition(x, y);
    this.player.body.reset(x, y);
    this.viewTop = Phaser.Math.Clamp(y - VIEW_H * 0.6, 0, this.rows * TILE - VIEW_H);
    for (const e of this.liveEnemies()) {
      const d = Phaser.Math.Distance.Between(e.x, e.y, x, y);
      if (d < TILE * 2 && !e.body.immovable) {
        const a = Phaser.Math.Angle.Between(x, y, e.x, e.y);
        e.setPosition(x + Math.cos(a) * TILE * 2.5, y + Math.sin(a) * TILE * 2.5);
      }
    }
  }

  setShield(ms: number) {
    this.shieldUntil = this.time.now + ms;
  }

  slowEnemies(ms: number, factor: number) {
    this.slowUntil = this.time.now + ms;
    this.slowAmount = factor;
    for (const b of [...this.enemyBullets.getChildren(), ...this.shells.getChildren()] as Phaser.Physics.Arcade.Image[]) b.body?.velocity.scale(factor);
    this.time.delayedCall(ms, () => {
      for (const b of [...this.enemyBullets.getChildren(), ...this.shells.getChildren()] as Phaser.Physics.Arcade.Image[]) b.body?.velocity.scale(1 / factor);
    });
  }

  reveal(ms: number) {
    this.revealUntil = this.time.now + ms;
  }

  bless(g: { lives?: number; sandstorms?: number; score?: number }) {
    if (g.lives) this.lives += g.lives;
    if (g.sandstorms) this.setGrenades(this.grenades + g.sandstorms);
    if (g.score) this.score += g.score;
    this.syncHud();
  }

  /** Sets score, lives and sandstorms directly (console and debugging). */
  setStats(s: { score?: number; lives?: number; grenades?: number }) {
    if (s.score !== undefined) this.score = Math.max(0, Math.floor(s.score));
    if (s.lives !== undefined) this.lives = Phaser.Math.Clamp(Math.floor(s.lives), 1, 99);
    if (s.grenades !== undefined) this.setGrenades(Phaser.Math.Clamp(Math.floor(s.grenades), 0, 99));
    this.syncHud();
  }

  get stats() {
    return { score: this.score, lives: this.lives, grenades: this.grenades };
  }

  /** Where the player is and what they carry, so a reloaded level can carry on from here. */
  snapshot(): Resume | undefined {
    if (this.state !== "playing" && this.state !== "dead") return undefined; // not after a win or game over
    return { x: this.player.x, y: this.player.y, viewTop: this.viewTop, score: this.score, lives: this.lives,
      grenades: this.grenades, pows: this.powsRescued, cats: this.army.length, gone: [...this.gone] };
  }

  /** World y at the top of the screen (the camera zooms about its centre, so scrollY is offset). */
  get viewTop() {
    return this.cameras.main.scrollY + (VIEW_H * (RES - 1)) / 2;
  }

  set viewTop(y: number) {
    this.cameras.main.scrollY = y - (VIEW_H * (RES - 1)) / 2;
  }

  update(time: number, delta: number) {
    if (this.registry.get("timeStopped")) { this.scene.pause(); return; } // rebuilt while the gods hold time still: stay frozen
    const worldW = this.cols * TILE;
    for (const c of this.clouds) {
      c.x += (c.getData("speed") * delta) / 1000;
      if (c.x > worldW + 400) c.x = -400;
    }
    if (this.state === "won" || this.state === "over") return;
    if (this.cinematic) return; // the gods are acting: the world holds still around them
    this.herdCats(delta);
    this.player.update(time);

    // scroll up when the player pushes past 55% of the screen
    const targetScroll = this.player.y - VIEW_H * 0.55;
    if (targetScroll < this.viewTop) this.viewTop = Math.max(0, targetScroll);
    // the player can't walk back below the screen
    const bottom = this.viewTop + VIEW_H - FRAME.bottom - 28;
    if (this.player.y > bottom) {
      this.player.y = bottom;
      this.player.body.setVelocityY(Math.min(0, this.player.body.velocity.y));
    }

    const p = new Phaser.Math.Vector2(this.player.x, this.player.y);
    for (const e of this.enemies) {
      if (!e.active) continue;
      if (e.y > this.viewTop + VIEW_H + TILE * 3) { e.destroy(); continue; } // left behind
      const onScreen = e.y > this.viewTop - TILE && e.y < this.viewTop + VIEW_H + TILE;
      if (onScreen && this.player.alive) e.update(time, p);
      else e.body.setVelocity(0, 0);
    }
    this.enemies = this.enemies.filter((e) => e.active);
    this.updateSight();

    this.wiggleAnkhs(time);

    // bullets stop at walls and range limit
    for (const group of [this.playerBullets, this.enemyBullets, this.shells]) {
      for (const obj of [...group.getChildren()] as Phaser.Physics.Arcade.Image[]) {
        const travelled = Phaser.Math.Distance.Between(obj.x, obj.y, obj.getData("x0"), obj.getData("y0"));
        if (this.terrainAt(obj.x, obj.y) === "##" || travelled > obj.getData("range")) {
          if (group === this.shells) this.explodeShell(obj);
          else this.bulletHit(obj);
        }
      }
    }

    // the temple gate stays shut while the Pharaoh lives
    if (this.boss?.active && this.player.y < TILE * 1.2) {
      this.player.y = TILE * 1.2;
      if (time > this.nextGateWarning) {
        this.nextGateWarning = time + 2500;
        this.fx.floatingText(this.player.x, this.player.y - 40, "DEFEAT THE PHARAOH!", "#ff7a5a");
      }
    }
    if (this.player.alive && this.player.y < TILE * 0.8) this.win();
  }

  // ---------------------------------------------------------------- terrain

  private buildTerrain() {
    const pick = (a: number[]) => a[Math.floor(Math.random() * a.length)];
    // pyramids are anchored top-left and cover 3x3 cells
    const pyramids: { x: number; y: number }[] = [];
    this.terrain.forEach((row, r) => row.forEach((code, c) => {
      if (code !== "py") return;
      pyramids.push({ x: (c + 1.5) * TILE, y: (r + 1.5) * TILE });
      for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) if (this.terrain[r + dr]?.[c + dc] !== undefined) this.terrain[r + dr][c + dc] = "PY";
    }));
    const F = DESERT_FRAMES;
    // objects (palms, statues, jars...) take the ground of their neighbours
    const near = (r: number, c: number, codes: string[]) => [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dr, dc]) => codes.includes(this.terrain[r + dr]?.[c + dc]));
    const ground = this.terrain.map((row, r) =>
      row.map((code, c) =>
        code === "rd" || code === "pv" ? pick(F.paving)
          : code === "~~" ? pick(F.water)
          : code === "==" ? pick(F.bridge)
          : code === "ff" || code === "rs" ? pick(F.fertile)
          : code === ".." || code === "PY" ? pick(F.sand)
          : ["ff", "rs"].includes(this.terrain[r][c - 1]) || ["ff", "rs"].includes(this.terrain[r][c + 1]) ? pick(F.fertile)
          : near(r, c, ["pv"]) ? pick(F.paving)
          : pick(F.sand)),
    );
    const walls = this.terrain.map((row) => row.map((c) => (c === "##" ? DESERT_FRAMES.wall[0] : -1)));

    const gMap = this.make.tilemap({ data: ground, tileWidth: TILE, tileHeight: TILE });
    this.groundLayer = gMap.createLayer(0, gMap.addTilesetImage("desert", "desert", TILE, TILE, 1, 2)!, 0, 0)!.setDepth(DEPTH.ground);
    this.groundLayer.setCollision(F.water);

    const wMap = this.make.tilemap({ data: walls, tileWidth: TILE, tileHeight: TILE });
    this.wallLayer = wMap.createLayer(0, wMap.addTilesetImage("desert", "desert", TILE, TILE, 1, 2)!, 0, 0)!.setDepth(DEPTH.litWalls);
    this.wallLayer.setCollisionByExclusion([-1]);

    const shadows = this.add.graphics().setDepth(DEPTH.wallShadow);
    shadows.fillStyle(0x000000, 0.45);
    this.solids = this.physics.add.staticGroup();

    this.forEachCell(this.terrain, (code, x, y) => {
      if (code === "##") {
        shadows.fillRect(x - TILE / 2 + 12, y - TILE / 2 + 14, TILE, TILE);
        this.sight.addOccluder(x - TILE / 2, y - TILE / 2, TILE, TILE);
      }
      else if (code === "sb") {
        this.addObstacle(this.add.image(x, y, "blocks").setDepth(DEPTH.litWalls), "sandbag", 999);
        this.sight.addOccluder(x - 30, y - 20, 60, 40);
      }
      else if (code === "bx") this.addObstacle(this.add.image(x, y, "jar"), "barrel", BARREL.hp);
      else if (code === "cr") this.addObstacle(this.add.image(x, y, "crate"), "crate", CRATE_HP);
      else if (code === "tr") this.addTree(x, y);
      else if (code === "rs") this.addReeds(x, y);
      else if (code === "ob") this.addMonument(x, y, "obelisk", 50, 170);
      else if (code === "co") this.addMonument(x, y, "column", 44, 40);
      else if (code === "an") this.addMonument(x, y, "anubis", 56, 30);
      else if (code === "bt") this.addMonument(x, y, "bastet", 56, 30);
    });
    for (const p of pyramids) this.addPyramid(p.x, p.y);

    this.decorateGround();
    this.blendBanks();
    this.addWaterShimmer();
    this.addRiverLife();
    this.addCloudShadows();
  }

  // Cosmetic: tile tint variation, scattered rocks and plants, soft road and river edges.
  private decorateGround() {
    this.wallLayer.forEachTile((t) => {
      if (t.index < 0) return;
      if (Math.random() < 0.5) {
        this.add.image(t.pixelX + TILE / 2, t.pixelY + TILE / 2, "glyphs").setDepth(DEPTH.litWalls + 0.05).setAlpha(0.55).setFlipX(Math.random() < 0.5);
      }
    });
    const edges = this.add.graphics().setDepth(DEPTH.decals);
    const at = (r: number, c: number) => this.terrain[r]?.[c];
    this.forEachCell(this.terrain, (code, x, y) => {
      const r = Math.floor(y / TILE), c = Math.floor(x / TILE);
      const left = x - TILE / 2, top = y - TILE / 2;
      if (code === "..") {
        if (Math.random() < 0.2) {
          this.add.image(x + Phaser.Math.Between(-20, 20), y + Phaser.Math.Between(-20, 20), "fx_chip") // a flat pebble
            .setScale(Phaser.Math.FloatBetween(0.6, 1.1)).setRotation(Math.random() * Math.PI * 2).setTint(0xe9955a).setDepth(DEPTH.decals);
        }
        if (Math.random() < 0.07) {
          this.add.image(x + Phaser.Math.Between(-16, 16), y + Phaser.Math.Between(-16, 16), "shrub")
            .setRotation(Math.random() * Math.PI * 2).setScale(Phaser.Math.FloatBetween(0.8, 1.3)).setDepth(DEPTH.decals);
        }
        // dunes: big soft light and dark swells
        if (Math.random() < 0.12) {
          this.add.image(x, y, Math.random() < 0.5 ? "shadow" : "glow").setScale(Phaser.Math.FloatBetween(3, 5), Phaser.Math.FloatBetween(1.5, 2.5))
            .setRotation(Phaser.Math.FloatBetween(-0.4, 0.4)).setAlpha(0.1).setDepth(DEPTH.decals);
        }
      }
      if (code === "rd") {
        edges.fillStyle(0x000000, 0.18);
        if (at(r, c - 1) !== "rd") edges.fillRect(left, top, 6, TILE);
        if (at(r, c + 1) !== "rd") edges.fillRect(left + TILE - 6, top, 6, TILE);
      }
      if (code === "~~" || code === "==") {
        // dark bank above/below the river, lighter foam line on the water
        if (at(r - 1, c) !== "~~" && at(r - 1, c) !== "==") {
          edges.fillStyle(0x5a3c1a, 0.85).fillRect(left, top, TILE, 9);
          edges.fillStyle(0x3a2810, 0.5).fillRect(left, top + 9, TILE, 3);
          if (code === "~~") edges.fillStyle(0xffffff, 0.25).fillRect(left, top + 12, TILE, 2);
        }
        if (at(r + 1, c) !== "~~" && at(r + 1, c) !== "==") {
          edges.fillStyle(0x5a3c1a, 0.85).fillRect(left, top + TILE - 8, TILE, 8);
          if (code === "~~") edges.fillStyle(0xffffff, 0.2).fillRect(left, top + TILE - 10, TILE, 2);
        }
      }
    });
  }

  // Cosmetic: the green banks fade into the desert over a few tiles instead of a hard edge.
  private blendBanks() {
    const green = (r: number, c: number) => ["ff", "rs"].includes(this.terrain[r]?.[c]) || (this.terrain[r]?.[c] === "tr" && (["ff", "rs"].includes(this.terrain[r][c - 1]) || ["ff", "rs"].includes(this.terrain[r][c + 1])));
    const sand = (r: number, c: number) => {
      const code = this.terrain[r]?.[c];
      return code !== undefined && !green(r, c) && !["~~", "==", "rd", "pv", "##"].includes(code);
    };
    this.forEachCell(this.terrain, (_code, x, y) => {
      const r = Math.floor(y / TILE), c = Math.floor(x / TILE);
      const top = y - TILE / 2, bottom = y + TILE / 2;
      if (sand(r, c) && green(r + 1, c)) { // grass thins out upwards into the sand
        this.add.image(x, bottom, "fade_green").setOrigin(0.5, 1).setDepth(DEPTH.ground + 0.5);
      }
      if (sand(r, c) && green(r - 1, c)) { // ...and downwards
        this.add.image(x, top, "fade_green").setOrigin(0.5, 1).setFlipY(true).setY(top + TILE * 2).setDepth(DEPTH.ground + 0.5);
      }
    });
  }

  // Big soft shadows drifting over the battlefield.
  private addCloudShadows() {
    const worldW = this.cols * TILE, worldH = this.rows * TILE;
    for (let y = 0; y < worldH; y += 520) {
      const cloud = this.add.image(Phaser.Math.Between(0, worldW), y + Phaser.Math.Between(0, 300), "shadow")
        .setScale(Phaser.Math.FloatBetween(7, 11), Phaser.Math.FloatBetween(4, 6))
        .setAlpha(0.22).setDepth(DEPTH.canopy + 1);
      cloud.setData("speed", Phaser.Math.Between(12, 22));
      this.clouds.push(cloud);
    }
  }

  private addObstacle(img: Phaser.GameObjects.Image, kind: string, hp: number) {
    img.setDepth(DEPTH.obstacles).setData("kind", kind).setData("hp", hp);
    img.setData("shadowImg", this.add.image(img.x + 6, img.y + 8, "shadow").setScale(1.1).setDepth(DEPTH.objShadow));
    this.solids.add(img);
    const body = img.body as Phaser.Physics.Arcade.StaticBody;
    if (kind === "barrel") body.setCircle(18, img.width / 2 - 18, img.height / 2 - 18);
  }

  /** Palm groves near water, flat-topped acacias out in the desert. */
  private addTree(x: number, y: number) {
    const r = Math.floor(y / TILE), c = Math.floor(x / TILE);
    let nearWater = false;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -1; dc <= 1; dc++) if (["ff", "rs", "~~"].includes(this.terrain[r + dr]?.[c + dc])) nearWater = true;
    if (nearWater) {
      this.addCanopy(x, y, "palm", Math.random() < 0.6 ? 1.05 : 0.85);
      // a couple of young palms around the trunk make a grove
      for (let i = 0; i < Phaser.Math.Between(1, 2); i++) {
        this.addCanopy(x + Phaser.Math.Between(-30, 30), y + Phaser.Math.Between(-30, 30), "palm", Phaser.Math.FloatBetween(0.45, 0.6));
      }
    } else {
      // out in the desert: cacti
      const saguaro = Math.random() < 0.6;
      const cactus = this.add.image(x, y, saguaro ? "cactus" : "pricklypear").setDepth(DEPTH.canopy)
        .setRotation(Math.random() * Math.PI * 2).setScale(Phaser.Math.FloatBetween(0.85, 1.1));
      this.add.image(x + 12, y + 16, "shadow").setScale(saguaro ? 2 : 1.6).setDepth(DEPTH.objShadow).setAlpha(0.7);
      this.tweens.add({ targets: cactus, scale: cactus.scale * 1.02, duration: 2400 + Math.random() * 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
    const trunk = this.add.zone(x, y, 30, 30).setData("kind", "tree");
    this.solids.add(trunk);
  }

  private addCanopy(x: number, y: number, texture: string, scale: number, shadowScale = 2.2) {
    const canopy = this.add.image(x + Phaser.Math.Between(-6, 6), y + Phaser.Math.Between(-6, 6), texture)
      .setDepth(DEPTH.canopy).setRotation(Math.random() * Math.PI * 2).setScale(scale);
    this.add.image(x + 14, y + 18, "shadow").setScale(shadowScale * scale).setDepth(DEPTH.objShadow).setAlpha(0.8);
    // gentle sway
    this.tweens.add({ targets: canopy, scale: scale * 1.03, rotation: canopy.rotation + 0.04, duration: 1800 + Math.random() * 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  private addReeds(x: number, y: number) {
    for (let i = 0; i < 2; i++) {
      this.add.image(x + Phaser.Math.Between(-16, 16), y + Phaser.Math.Between(-16, 16), "reeds")
        .setRotation(Math.random() * Math.PI * 2).setScale(Phaser.Math.FloatBetween(1.2, 1.6)).setDepth(DEPTH.obstacles);
    }
  }

  /** Stone landmark: blocks movement and bullets, can't be destroyed. Casts a long shadow to the bottom-right. */
  private addMonument(x: number, y: number, texture: string, size: number, shadowLength: number) {
    const shadow = this.add.graphics().setDepth(DEPTH.wallShadow);
    shadow.fillStyle(0x3a1e00, 0.35);
    const w = size * 0.7, a = Math.atan2(0.8, 1);
    shadow.fillPoints([
      { x: x - (w / 2) * Math.sin(a), y: y + (w / 2) * Math.cos(a) },
      { x: x + (w / 2) * Math.sin(a), y: y - (w / 2) * Math.cos(a) },
      { x: x + (w / 2) * Math.sin(a) + Math.cos(a) * shadowLength, y: y - (w / 2) * Math.cos(a) + Math.sin(a) * shadowLength },
      { x: x - (w / 2) * Math.sin(a) + Math.cos(a) * shadowLength, y: y + (w / 2) * Math.cos(a) + Math.sin(a) * shadowLength },
    ], true);
    const img = this.add.image(x, y, texture).setDepth(DEPTH.litWalls).setData("kind", "stone").setData("hp", 999);
    this.solids.add(img);
    (img.body as Phaser.Physics.Arcade.StaticBody).setSize(size, size);
    this.sight.addOccluder(x - size / 2, y - size / 2, size, size);
  }

  private addPyramid(x: number, y: number) {
    const h = TILE * 1.5 - 4;
    const shadow = this.add.graphics().setDepth(DEPTH.wallShadow);
    shadow.fillStyle(0x3a1e00, 0.38);
    // the apex's shadow falls to the bottom-right; the base hides the rest
    shadow.fillPoints([{ x: x + h, y: y - h }, { x: x + h + 60, y: y + h + 50 }, { x: x - h, y: y + h }], true);
    const img = this.add.image(x, y, "pyramid").setDepth(DEPTH.litWalls).setData("kind", "stone").setData("hp", 999);
    this.sight.addOccluder(x - h, y - h, h * 2, h * 2);
    this.solids.add(img);
  }

  /** Dim what the player can't see, and fade out enemies, their shots and the cats behind cover. */
  private updateSight() {
    if (this.time.now < this.revealUntil || !settings.lineOfSight) { // the Eye of Horus (or the setting): nothing is hidden
      this.sight.setVisible(false);
      for (const e of this.enemies) e.setSeenAlpha(1);
      return;
    }
    this.sight.setVisible(true);
    this.sight.update(this.player.x, this.player.y, new Phaser.Geom.Rectangle(0, this.viewTop, VIEW_W, VIEW_H));
    const fade = (o: { x: number; y: number; alpha: number }) => {
      const target = this.sight.canSee(o.x, o.y) ? 1 : 0;
      return o.alpha + (target - o.alpha) * 0.25;
    };
    for (const e of this.enemies) e.setSeenAlpha(fade(e));
    for (const group of [this.enemyBullets, this.shells]) {
      for (const b of group.getChildren() as Phaser.Physics.Arcade.Image[]) b.setAlpha(fade(b));
    }
    for (const c of this.cats) c.setAlpha(fade(c));
  }

  /** Lots of cats, scattered over the open ground (not too close to the start). */
  private scatterCats() {
    const spots: { x: number; y: number }[] = [];
    this.forEachCell(this.terrain, (code, x, y) => {
      if (["..", "ff", "pv"].includes(code) && y < (this.rows - 5) * TILE) spots.push({ x, y });
    });
    Phaser.Utils.Array.Shuffle(spots);
    for (const p of spots.slice(0, CATS.extra)) this.addCat(p.x + Phaser.Math.Between(-16, 16), p.y + Phaser.Math.Between(-16, 16));
  }

  // Wild cats wander about; when you come near they pad over, and touching one adds it to your army.
  private addCat(x: number, y: number) {
    this.catsTotal++;
    const cat = this.add.image(x, y, "cat").setDepth(DEPTH.units - 1)
      .setTint(Phaser.Utils.Array.GetRandom(CAT_COATS))
      .setRotation(Math.random() * Math.PI * 2);
    this.cats.push(cat);
    const wander = () => {
      if (!cat.active || this.army.includes(cat)) return;
      if (!cat.getData("lured") && Math.random() < 0.6) this.wanderCat(cat);
      this.time.delayedCall(Phaser.Math.Between(1500, 4000), wander);
    };
    wander();
  }

  private wanderCat(cat: Phaser.GameObjects.Image) {
    const angle = Math.random() * Math.PI * 2, dist = Phaser.Math.Between(30, 80);
    const tx = cat.x + Math.cos(angle) * dist, ty = cat.y + Math.sin(angle) * dist;
    if (!WALKABLE.has(this.terrainAt(tx, ty))) return;
    cat.setRotation(angle);
    this.tweens.add({ targets: cat, x: tx, y: ty, duration: (dist / 55) * 1000, ease: "Sine.easeInOut" });
  }

  private herdCats(delta: number) {
    if (!this.player.alive) return;
    const dt = delta / 1000;
    // remember where the player has walked: the army follows the trail
    const last = this.trail[0];
    if (!last || Phaser.Math.Distance.Between(last.x, last.y, this.player.x, this.player.y) > 6) {
      this.trail.unshift({ x: this.player.x, y: this.player.y });
      this.trail.length = Math.min(this.trail.length, (this.army.length + 2) * CATS.followGap + 8);
    }
    for (const cat of [...this.cats]) {
      if (this.army.includes(cat)) continue;
      const d = Phaser.Math.Distance.Between(cat.x, cat.y, this.player.x, this.player.y);
      if (d < CATS.catchDistance) { this.recruitCat(cat); continue; }
      if (d > CATS.lureDistance) { cat.setData("lured", false); continue; }
      // come here, kitty
      if (!cat.getData("lured")) {
        cat.setData("lured", true);
        this.tweens.killTweensOf(cat);
        if (Math.random() < 0.4) this.fx.floatingText(cat.x, cat.y - 24, Phaser.Utils.Array.GetRandom(["mrrp?", "meow!", "purr"]), "#ffffff");
      }
      const a = Phaser.Math.Angle.Between(cat.x, cat.y, this.player.x, this.player.y);
      cat.setRotation(a).setPosition(cat.x + Math.cos(a) * CATS.lureSpeed * dt, cat.y + Math.sin(a) * CATS.lureSpeed * dt);
    }
    // the army fights: each cat picks the nearest enemy the player can see, and comes back when it's gone
    const targets = this.enemies.filter((e) => e.active && Phaser.Math.Distance.Between(e.x, e.y, this.player.x, this.player.y) < CATS.attackRange && this.sight.canSee(e.x, e.y));
    // the army trots along the trail, fanned out a little to either side
    this.army.forEach((cat, i) => {
      let target = cat.getData("target") as Enemy | undefined;
      if (target && !targets.includes(target)) target = undefined;
      if (!target && targets.length) target = targets.reduce((a, b) => (Phaser.Math.Distance.Between(cat.x, cat.y, a.x, a.y) < Phaser.Math.Distance.Between(cat.x, cat.y, b.x, b.y) ? a : b));
      cat.setData("target", target);
      if (target) {
        const a = Phaser.Math.Angle.Between(cat.x, cat.y, target.x, target.y);
        const d = Phaser.Math.Distance.Between(cat.x, cat.y, target.x, target.y);
        cat.setRotation(a);
        if (d > 30) cat.setPosition(cat.x + Math.cos(a) * CATS.attackSpeed * dt, cat.y + Math.sin(a) * CATS.attackSpeed * dt);
        else if (this.time.now > (cat.getData("nextBite") ?? 0)) {
          cat.setData("nextBite", this.time.now + CATS.biteMs);
          this.fx.claw(target.x + Phaser.Math.Between(-10, 10), target.y + Phaser.Math.Between(-10, 10));
          target.damage(CATS.biteDamage, false);
        }
        return;
      }
      const spot = this.trail[Math.min(this.trail.length - 1, (i + 1) * CATS.followGap)];
      const next = this.trail[Math.max(0, (i + 1) * CATS.followGap - 2)];
      if (!spot || !next) return;
      const heading = Phaser.Math.Angle.Between(spot.x, spot.y, next.x, next.y);
      const side = ((i % 3) - 1) * CATS.followSpread;
      const tx = spot.x + Math.cos(heading + Math.PI / 2) * side, ty = spot.y + Math.sin(heading + Math.PI / 2) * side;
      const dx = tx - cat.x, dy = ty - cat.y;
      if (Math.hypot(dx, dy) > 2) cat.setRotation(Math.atan2(dy, dx));
      cat.setPosition(cat.x + dx * Math.min(1, dt * 8), cat.y + dy * Math.min(1, dt * 8));
    });
  }

  /** Ankh bolts weave from side to side as they fly; the bigger the cat army, the wilder they get. */
  private wiggleAnkhs(time: number) {
    const n = this.army.length;
    const amp = Math.min(ANKH.maxAmplitude, ANKH.amplitude + n * ANKH.amplitudePerCat);
    const k = (Math.PI * 2) / ANKH.wavelength;
    const power = this.ankhPower() / ANKH.maxPower; // 1/3 .. 1
    for (const b of this.playerBullets.getChildren() as Phaser.Physics.Arcade.Image[]) {
      const angle = b.getData("angle"), speed = b.getData("speed");
      const d = Phaser.Math.Distance.Between(b.x, b.y, b.getData("x0"), b.getData("y0"));
      // sideways speed is the derivative of amp * sin(k * d): a smooth snake-like path
      const side = amp * k * speed * Math.cos(k * d + b.getData("phase"));
      b.body!.velocity.set(Math.cos(angle) * speed - Math.sin(angle) * side, Math.sin(angle) * speed + Math.cos(angle) * side);
      b.setRotation(Math.atan2(b.body!.velocity.y, b.body!.velocity.x) + Math.PI / 2);
      b.setScale(0.6 + 0.6 * power + 0.06 * Math.sin(time / 45 + d / 20));
      if (n >= 5 && Math.random() < 0.08 + n * 0.006) this.fx.sparkle(b.x, b.y, n, b.tintTopLeft);
    }
  }

  /** Damage of one ankh bolt: grows with the cat army. */
  private ankhPower() {
    return Math.min(ANKH.maxPower, ANKH.power + this.army.length * ANKH.powerPerCat);
  }

  private recruitCat(cat: Phaser.GameObjects.Image) {
    this.markGone(cat);
    audio.play("meow");
    this.tweens.killTweensOf(cat);
    this.army.push(cat);
    this.catsCaught++;
    this.addScore(CATS.score);
    this.fx.floatingText(cat.x, cat.y - 24, `CAT ARMY ${this.catsCaught}`, "#ffd0e8");
    this.tweens.add({ targets: cat, scale: 1.3, duration: 120, yoyo: true });
    this.syncHud();
  }

  // Cosmetic: lotus, current, crocodiles and a felucca on each stretch of river.
  private addRiverLife() {
    const bands: { top: number; bottom: number }[] = [];
    this.terrain.forEach((row, r) => {
      if (!row.includes("~~")) return;
      const last = bands[bands.length - 1];
      if (last && last.bottom === r - 1) last.bottom = r;
      else bands.push({ top: r, bottom: r });
    });
    this.forEachCell(this.terrain, (code, x, y) => {
      if (code !== "~~") return;
      if (Math.random() < 0.3) {
        const pad = this.add.image(x + Phaser.Math.Between(-20, 20), y + Phaser.Math.Between(-20, 20), "lotus_pad")
          .setRotation(Math.random() * Math.PI * 2).setScale(Phaser.Math.FloatBetween(0.8, 1.3)).setDepth(DEPTH.decals + 0.2);
        this.tweens.add({ targets: pad, rotation: pad.rotation + 0.3, x: pad.x + 6, duration: 4000 + Math.random() * 3000, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
        if (Math.random() < 0.4) this.add.image(pad.x + 4, pad.y - 3, "lotus_flower").setDepth(DEPTH.decals + 0.3).setScale(0.9).setTint(Phaser.Utils.Array.GetRandom([0xffffff, 0xffc0d8, 0xb0c8ff]));
      }
      // the current: pale streaks drifting downstream
      const streak = this.add.image(x, y + Phaser.Math.Between(-24, 24), "streak").setDepth(DEPTH.decals + 0.1).setAlpha(0).setScale(1.5, 1).setTint(0xcfefff);
      this.tweens.add({ targets: streak, x: x + 70, alpha: { from: 0, to: 0.35 }, duration: 2400, delay: Math.random() * 2400, repeat: -1, yoyo: false, ease: "Linear",
        onRepeat: () => streak.setAlpha(0) });
    });
    for (const band of bands) {
      const midY = ((band.top + band.bottom + 1) / 2) * TILE;
      // crocodiles drift, then sink until only the eyes show
      for (let i = 0; i < (band.bottom - band.top >= 2 ? 3 : 1); i++) {
        const cx = Phaser.Math.Between(1, 5) * TILE + (i % 2) * 9 * TILE, cy = midY + Phaser.Math.Between(-20, 20);
        const croc = this.add.image(cx, cy, "croc").setDepth(DEPTH.decals + 0.4).setFlipX(Math.random() < 0.5);
        this.tweens.add({ targets: croc, x: cx + (croc.flipX ? -90 : 90), duration: 9000, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
          onYoyo: () => croc.setFlipX(!croc.flipX), onRepeat: () => croc.setFlipX(!croc.flipX) });
        this.tweens.add({ targets: croc, alpha: 0.25, duration: 1500, delay: Math.random() * 4000, hold: 2500, repeatDelay: 4000, yoyo: true, repeat: -1 });
      }
      // a felucca sails the big river
      if (band.bottom - band.top >= 2) {
        // sail the longest open stretch between bridges, turning round at each end
        const row = this.terrain[band.top + 1];
        let best = [0, 0], start = -1;
        for (let c = 0; c <= this.cols; c++) {
          if (row[c] === "~~") { if (start < 0) start = c; }
          else if (start >= 0) { if (c - start > best[1] - best[0]) best = [start, c]; start = -1; }
        }
        const x0 = best[0] * TILE + 70, x1 = best[1] * TILE - 70;
        const boat = this.add.image(x0, midY - 10, "felucca").setDepth(DEPTH.obstacles);
        const sail = (to: number) => {
          boat.setFlipX(to < boat.x);
          this.tweens.add({ targets: boat, x: to, duration: Math.abs(to - boat.x) * 40, ease: "Sine.easeInOut", delay: 1500,
            onUpdate: () => { boat.y = midY - 10 + Math.sin(this.time.now / 600) * 3; },
            onComplete: () => sail(to === x1 ? x0 : x1) });
        };
        if (x1 > x0) sail(x1);
      }
    }
  }

  private addWaterShimmer() {
    this.forEachCell(this.terrain, (code, x, y) => {
      if (code !== "~~") return;
      for (let i = 0; i < 2; i++) {
        const g = this.add.image(x + Phaser.Math.Between(-24, 24), y + Phaser.Math.Between(-24, 24), "glow")
          .setDepth(DEPTH.decals).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5, 0.15).setAlpha(0);
        this.tweens.add({ targets: g, alpha: 0.5, x: g.x + 12, duration: 1200 + Math.random() * 1500, delay: Math.random() * 3000, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      }
    });
  }

  // ---------------------------------------------------------------- units

  /** Units already dealt with this game, by map cell, so a rebuild (the gods reshaping the land) doesn't bring them back. */
  private gone = new Set<string>();

  private markGone(o: { getData(key: string): unknown }) {
    const cell = o.getData("cell");
    if (typeof cell === "string") this.gone.add(cell);
  }

  private buildUnits(gone: string[] = []) {
    this.powsTotal = 0;
    this.catsTotal = 0;
    this.gone = new Set(gone);
    this.forEachCell(this.units, (code, x, y) => {
      const cell = `${Math.floor(y / TILE)}:${Math.floor(x / TILE)}`;
      if (code === "h1") this.powsTotal++; // still counts towards RESCUED x/3
      if (code === ".." || this.gone.has(cell)) return;
      const before = this.enemies.length, pickups = this.pickups.getLength(), cats = this.cats.length;
      this.buildUnit(code, x, y);
      for (const e of this.enemies.slice(before)) e.setData("cell", cell);
      for (const p of (this.pickups.getChildren() as Phaser.GameObjects.Image[]).slice(pickups)) p.setData("cell", cell);
      for (const c of this.cats.slice(cats)) c.setData("cell", cell);
    });
  }

  private buildUnit(code: string, x: number, y: number) {
    if (code === "k1") {
      this.boss = new Chariot(this, x + TILE / 2, y); // drives along its row, centred on the road
      this.enemies.push(this.boss);
      return;
    }
    if (code === "t1") {
      const e = createEnemy(code, this, x + TILE / 2, y + TILE / 2); // 2x2 footprint
      if (e) this.enemies.push(e);
      return;
    }
    const e = createEnemy(code, this, x, y);
    if (e) {
      this.enemies.push(e);
      return;
    }
    if (code === "c1") {
      this.addCat(x, y);
    } else if (code === "h1") {
      const pow = this.pickups.create(x, y, "pow").setData("kind", "pow").setDepth(DEPTH.units).setRotation(Math.PI / 2);
      const help = this.add.text(x, y - 38, "HELP!", { fontFamily: "Avenir Next, Arial", fontSize: "14px", fontStyle: "bold", color: "#fff" })
        .setOrigin(0.5).setStroke("#000", 3).setDepth(DEPTH.text).setResolution(RES);
      pow.setData("label", help);
      this.tweens.add({ targets: help, y: help.y - 6, duration: 500, yoyo: true, repeat: -1 });
    } else if (code === "g1") {
      const box = this.pickups.create(x, y, "grenade_box").setData("kind", "grenades").setDepth(DEPTH.obstacles);
      this.tweens.add({ targets: box, scale: 1.15, duration: 600, yoyo: true, repeat: -1 });
    }
  }

  bossAppeared(boss: Chariot) {
    audio.play("bossHorn");
    audio.setMood("boss");
    this.registry.set("boss", { name: "Pharaoh", hp: boss.hp, max: boss.maxHp });
    this.events.emit("boss");
    this.cameras.main.shake(400, 0.006);
  }

  /** Run over by the chariot. */
  trample() {
    this.hurtPlayer();
  }

  onEnemyKilled(e: Enemy) {
    this.markGone(e);
    audio.play(e.armored ? "bigExplosion" : "enemyDeath");
    if (e === this.boss) this.pharaohFallen(e);
    this.addScore(e.score);
    this.fx.floatingText(e.x, e.y - 20, `${e.score}`);
    if (!(e.armored)) {
      this.fx.explosion(e.x, e.y, 0.35);
      this.leaveWreck(e.x, e.y, e.rotation, "soldier");
    }
  }

  /** The Pharaoh is the goal: once he falls (killed, or removed by a god) the game is won, after a
   *  moment to see him go down. */
  private pharaohFallen(e: Enemy) {
    this.registry.set("boss", null);
    audio.play("bossDown");
    audio.setMood("calm");
    this.fx.floatingText(e.x, e.y - 60, "THE PHARAOH HAS FALLEN!", "#f6d77a");
    this.time.delayedCall(1500, () => { if (this.state === "playing") this.win(); });
  }

  leaveWreck(x: number, y: number, rotation: number, kind: "tank" | "bunker" | "soldier") {
    if (kind === "soldier") {
      const body = this.add.image(x, y, "mummy").setRotation(rotation).setTint(0x333333).setAlpha(0.55).setDepth(DEPTH.decals);
      this.tweens.add({ targets: body, alpha: 0, delay: 4000, duration: 2000, onComplete: () => body.destroy() });
      return;
    }
    // sphinx rubble (tanks and bunkers are both sphinxes now)
    const wreck = this.add.image(x, y, "sphinx").setRotation(kind === "bunker" ? Math.PI : rotation).setTint(0x2a2a2a).setDepth(DEPTH.decals + 0.5);
    wreck.setScale(kind === "tank" ? 1.2 : 0.75);
    // smoke keeps rising from the wreck
    this.time.addEvent({
      delay: 220, repeat: 40, callback: () => {
        const s = this.add.image(x + Phaser.Math.Between(-10, 10), y, `smoke_grey${Phaser.Math.Between(0, 5)}`).setDepth(DEPTH.fx - 1).setScale(0.25).setAlpha(0.6);
        this.tweens.add({ targets: s, y: y - 90, x: s.x + 20, scale: 0.8, alpha: 0, duration: 2200, onComplete: () => s.destroy() });
      },
    });
  }

  dropTrackDecal(x: number, y: number, rotation: number) {
    const t = this.add.image(x, y, "pawprints").setRotation(rotation).setDepth(DEPTH.decals).setAlpha(0.45);
    this.tweens.add({ targets: t, alpha: 0, delay: 5000, duration: 3000, onComplete: () => t.destroy() });
  }

  // ---------------------------------------------------------------- weapons

  fireBullet(side: Side, x: number, y: number, angle: number, speed: number, range: number) {
    if (side === "enemy") speed *= this.slowFactor(this.time.now);
    audio.play(side === "player" ? "shot" : "enemyShot");
    const group = side === "player" ? this.playerBullets : this.enemyBullets;
    const b = group.create(x, y, side === "player" ? "ankh_bolt" : "bullet_enemy") as Phaser.Physics.Arcade.Image;
    b.setDepth(DEPTH.bullets).setRotation(angle + Math.PI / 2).setScale(side === "player" ? 0.75 : 0.45).setBlendMode(Phaser.BlendModes.ADD);
    b.setData({ x0: x, y0: y, range, angle, speed, phase: Math.random() * Math.PI * 2 });
    b.body!.setSize(10, 10);
    this.physics.velocityFromRotation(angle, speed, b.body!.velocity);
    if (side === "enemy") b.setTint(0x8aff5a); // cursed green
    else b.setTint(0xffd34a); // gold ankhs
  }

  fireShell(x: number, y: number, angle: number, speed: number, range: number) {
    audio.play("shell");
    const s = this.shells.create(x, y, "catbomb") as Phaser.Physics.Arcade.Image; // spat by a sphinx
    s.setDepth(DEPTH.bullets).setRotation(angle).setScale(1.1).setData({ x0: x, y0: y, range });
    this.physics.velocityFromRotation(angle, speed, s.body!.velocity);
    (s.body as Phaser.Physics.Arcade.Body).setAngularVelocity(540);
  }

  lobGrenade(side: Side, x0: number, y0: number, x1: number, y1: number) {
    audio.play("lob");
    const g = this.add.image(x0, y0, side === "player" ? "sandbomb" : "grenade").setDepth(DEPTH.bullets);
    const shadow = this.add.image(x0, y0, "shadow").setScale(0.3).setDepth(DEPTH.unitShadow);
    const state = { t: 0 };
    this.tweens.add({
      targets: state,
      t: 1,
      duration: GRENADE.flightMs,
      onUpdate: () => {
        const x = Phaser.Math.Linear(x0, x1, state.t), y = Phaser.Math.Linear(y0, y1, state.t);
        const h = Math.sin(state.t * Math.PI) * 70;
        shadow.setPosition(x, y);
        g.setPosition(x, y - h).setScale(1 + h / 60).setRotation(state.t * 12);
        if (side === "player" && Math.random() < 0.5) this.fx.sandTrickle(g.x, g.y); // sand leaking from the sack
      },
      onComplete: () => {
        g.destroy();
        shadow.destroy();
        if (side === "player") this.sandstorm(x1, y1);
        else this.explodeAt(x1, y1, GRENADE.radius, GRENADE.damage, side, 1);
      },
    });
  }

  /** The player's grenade: a sand cloud that blinds, slows and wears down enemies inside it. */
  sandstorm(x: number, y: number) {
    audio.play("sandstorm");
    this.fx.sandstorm(x, y, SANDSTORM.radius, SANDSTORM.durationMs);
    const ticks = Math.floor(SANDSTORM.durationMs / SANDSTORM.tickMs);
    const tick = () => {
      for (const e of [...this.enemies]) {
        if (!e.active || Phaser.Math.Distance.Between(x, y, e.x, e.y) > SANDSTORM.radius) continue;
        e.blindUntil = this.time.now + SANDSTORM.tickMs + 100;
        e.damage(SANDSTORM.damage, false);
      }
    };
    tick();
    this.time.addEvent({ delay: SANDSTORM.tickMs, repeat: ticks - 1, callback: tick });
  }

  /** Area damage. Player grenades hurt enemies; enemy grenades hurt the player; barrels hurt everyone. */
  explodeAt(x: number, y: number, radius: number, damage: number, side: Side | "all", size: number) {
    this.fx.explosion(x, y, size);
    audio.play(size >= 1.4 ? "bigExplosion" : "explosion");
    const inRange = (o: { x: number; y: number }) => Phaser.Math.Distance.Between(x, y, o.x, o.y) < radius;
    if (side !== "enemy") for (const e of [...this.enemies]) if (e.active && inRange(e)) e.damage(damage, false);
    if (side !== "player" && this.player.alive && inRange(this.player)) this.hurtPlayer();
    for (const o of [...(this.solids.getChildren() as unknown as Obstacle[])]) {
      if (o.active && inRange(o) && (o.getData("kind") === "barrel" || o.getData("kind") === "crate")) {
        this.time.delayedCall(90, () => this.damageObstacle(o, damage));
      }
    }
  }

  private bulletHit(b: Phaser.Physics.Arcade.Image) {
    if (!b.active) return;
    this.fx.impact(b.x, b.y);
    b.destroy();
  }

  private bulletVsObstacle(b: Phaser.Physics.Arcade.Image, o: Obstacle) {
    if (!b.active) return;
    this.bulletHit(b);
    this.damageObstacle(o, 1);
  }

  private explodeShell(s: Phaser.Physics.Arcade.Image) {
    if (!s.active) return;
    const { x, y } = s;
    s.destroy();
    this.explodeAt(x, y, 60, 2, "enemy", 0.7);
  }

  private damageObstacle(o: Obstacle, amount: number) {
    if (!o.active) return;
    const kind = o.getData("kind");
    if (kind !== "barrel" && kind !== "crate") return;
    const hp = o.getData("hp") - amount;
    o.setData("hp", hp);
    if (o instanceof Phaser.GameObjects.Image) this.fx.hitFlash(o);
    if (hp > 0) return;
    const { x, y } = o;
    o.getData("shadowImg")?.destroy();
    o.destroy();
    this.setTerrainAt(x, y, "..");
    if (kind === "barrel") this.explodeAt(x, y, BARREL.radius, BARREL.damage, "all", 1.4);
    else { this.fx.explosion(x, y, 0.4); audio.play("explosion"); }
  }

  // ---------------------------------------------------------------- player

  private hurtPlayer() {
    if (this.registry.get("invincible") || this.time.now < this.shieldUntil || this.cinematic) return;
    if (!this.player.alive || this.time.now < this.player.invulnerableUntil || this.state !== "playing") return;
    this.player.alive = false;
    audio.play("playerDeath");
    this.player.body.setVelocity(0, 0);
    this.player.setVisible(false);
    this.fx.explosion(this.player.x, this.player.y, 0.5);
    this.lives--;
    this.syncHud();
    if (this.lives <= 0) {
      this.state = "over";
      this.time.delayedCall(900, () => { audio.play("gameOver"); this.events.emit("gameover", { won: false, score: this.score }); });
      return;
    }
    this.time.delayedCall(1200, () => this.respawn());
  }

  private respawn() {
    // find a walkable cell near the bottom centre of the screen
    const row = Math.min(this.rows - 1, Math.floor((this.viewTop + VIEW_H - TILE) / TILE));
    let best = { x: this.player.x, y: this.player.y };
    for (let r = row; r > row - 4; r--) {
      const cols = [7, 8, 6, 9, 5, 10, 4, 11];
      const c = cols.find((c) => WALKABLE.has(this.terrain[r][c]));
      if (c !== undefined) { best = { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 }; break; }
    }
    this.player.setPosition(best.x, best.y).setVisible(true);
    this.player.alive = true;
    this.player.invulnerableUntil = this.time.now + PLAYER.invulnerableMs;
  }

  private collect(item: Phaser.Physics.Arcade.Image) {
    if (!item.active) return;
    this.markGone(item);
    audio.play(item.getData("kind") === "pow" ? "rescue" : "pickup");
    if (item.getData("kind") === "pow") {
      this.powsRescued++;
      this.addScore(POW_SCORE);
      this.fx.floatingText(item.x, item.y - 30, "RESCUED!", "#9fffa0");
      item.getData("label")?.destroy();
      item.disableBody(true, false);
      this.tweens.add({ targets: item, y: item.y + 300, alpha: 0, duration: 2000, onComplete: () => item.destroy() });
    } else {
      this.setGrenades(this.grenades + GRENADE_PICKUP);
      this.fx.floatingText(item.x, item.y - 20, `+${GRENADE_PICKUP} SANDSTORMS`, "#ffe27a");
      item.destroy();
    }
    this.syncHud();
  }

  private win() {
    this.state = "won";
    audio.play("win");
    this.player.body.setVelocity(0, 0);
    this.events.emit("gameover", { won: true, score: this.score + this.lives * 500 });
  }

  // ---------------------------------------------------------------- helpers

  /** Arcade callbacks don't guarantee argument order; returns [member of group, other]. */
  private split(group: Phaser.Physics.Arcade.Group, a: unknown, b: unknown): [Phaser.GameObjects.GameObject, Phaser.GameObjects.GameObject] {
    const ga = a as Phaser.GameObjects.GameObject, gb = b as Phaser.GameObjects.GameObject;
    return group.contains(ga) ? [ga, gb] : [gb, ga];
  }

  setGrenades(n: number) {
    this.grenades = n;
    this.syncHud();
  }

  private addScore(n: number) {
    this.score += n;
    this.syncHud();
  }

  private syncHud() {
    this.registry.set("hud", {
      score: this.score, lives: this.lives, grenades: this.grenades, pows: this.powsRescued, powsTotal: this.powsTotal,
      cats: this.catsCaught, catsTotal: this.catsTotal,
    });
  }

  private forEachCell(grid: Grid, fn: (code: string, x: number, y: number) => void) {
    grid.forEach((row, r) => row.forEach((code, c) => fn(code, c * TILE + TILE / 2, r * TILE + TILE / 2)));
  }

  private cellAt(x: number, y: number) {
    const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols ? { r, c } : null;
  }

  terrainAt(x: number, y: number) {
    const cell = this.cellAt(x, y);
    return cell ? this.terrain[cell.r][cell.c] : "##";
  }

  private setTerrainAt(x: number, y: number, code: string) {
    const cell = this.cellAt(x, y);
    if (cell) this.terrain[cell.r][cell.c] = code;
  }

  isRoadAt(x: number, y: number) {
    return ROAD.has(this.terrainAt(x, y));
  }
}
