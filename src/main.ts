import Phaser from "phaser";
import { RES, VIEW_H, VIEW_W, fitView } from "./config";
import { BootScene } from "./scenes/BootScene";
import { GameScene } from "./scenes/GameScene";
import { HudScene } from "./scenes/HudScene";
import { LEVEL_NAME, TERRAIN, UNITS } from "./level";
import { parseGrid, type Checked, type Level } from "./levelFormat";
import { performDecree, performPrank } from "./council/powers";
import { mountCouncil } from "./council/ui";
import { mountTouch, touch } from "./touch";

// The level comes from data/levels/*.toml through the dev server; a production build
// (no server) falls back to the copy bundled in src/level.ts.
async function firstLevel(): Promise<{ level: Level; error?: string[] }> {
  const bundled = () => {
    const terrain = parseGrid(TERRAIN), units = parseGrid(UNITS);
    return { name: LEVEL_NAME, width: 16, height: terrain.length, terrain, units };
  };
  if (!import.meta.env.DEV) return { level: bundled() };
  try {
    const r = (await (await fetch("/api/level")).json()) as Checked;
    return r.ok ? { level: r.level } : { level: bundled(), error: r.errors };
  } catch {
    return { level: bundled(), error: ["could not reach the dev server's /api/level"] };
  }
}
const first = await firstLevel();

// WebGL can't start on a zero-sized page (e.g. a collapsed browser pane): it fails with
// "Framebuffer status: Incomplete Attachment" and leaves a blank screen. So wait until the page has a size.
await new Promise<void>((ready) => {
  const sized = () => (document.getElementById("game")?.clientWidth ?? 0) > 0 && window.innerHeight > 0;
  if (sized()) return ready();
  const poll = setInterval(() => { if (sized()) { clearInterval(poll); ready(); } }, 250);
});

fitView(); // again, now the touch controls have taken their space below the game
const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: "game",
  width: Math.round(VIEW_W * RES),
  height: Math.round(VIEW_H * RES),
  backgroundColor: "#1d2b1d",
  pixelArt: false,
  physics: { default: "arcade", arcade: { debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER }, // #game centres it; Phaser centring too pushes it off-centre after a rotation
  scene: [BootScene, GameScene, HudScene],
  callbacks: {
    preBoot: (g) => {
      g.registry.set("level", first.level);
      g.registry.set("levelError", first.error ?? null);
    },
  },
});

// Dev-only handles for debugging from the browser console (and for agents driving a browser).
if (import.meta.env.DEV) Object.assign(window, { game, gods: { performDecree, performPrank } });

// Hot reload: a good level replaces the old one and the game rebuilds around the player, who keeps
// their place, score, lives and cat army;
// a broken one is reported in the HUD and the last good level keeps running.
if (import.meta.hot) {
  import.meta.hot.on("level:changed", (r: Checked) => {
    if (!r.ok) return void game.registry.set("levelError", r.errors);
    game.registry.set("levelError", null);
    if (JSON.stringify(r.level) === JSON.stringify(game.registry.get("level"))) return; // already playing it (e.g. a new game's reset)
    game.registry.set("level", r.level);
    const scene = game.scene.getScene("game") as GameScene | null;
    if (scene && (game.scene.isActive("game") || game.scene.isPaused("game"))) scene.scene.restart({ resume: scene.snapshot() });
  });
}

// A phone turned (or the window changed shape): the game takes the new shape in place. Nothing restarts.
let fitting: ReturnType<typeof setTimeout> | undefined;
new ResizeObserver(() => {
  clearTimeout(fitting);
  fitting = setTimeout(() => {
    if (!fitView()) return;
    game.scale.setGameSize(Math.round(VIEW_W * RES), Math.round(VIEW_H * RES));
    for (const key of ["game", "hud"] as const) {
      const scene = game.scene.getScene(key) as (GameScene | HudScene) | null;
      if (scene?.sys.isActive() || scene?.sys.isPaused()) scene.refit();
    }
  }, 150);
}).observe(document.getElementById("game")!);

const council = mountCouncil(game); // press E: answered by the built-in model, or by Claude when running locally
touch.gods = () => council.open();
mountTouch();
