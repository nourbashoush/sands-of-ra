import type Phaser from "phaser";
import { audio } from "./audio";
import { settings, type Difficulty } from "./settings";

// The pause / game-over menu: Resume, New game (or Play again), Settings. A flat card over the game,
// in the same style as the rest of the HUD. The HUD scene opens it and owns what the buttons do.

export type MenuOptions = {
  title: string;
  subtitle: string;
  /** Pause: Resume is offered. Game over: only Play again. */
  onResume?: () => void;
  onNewGame: () => void;
};

/** Flat icons drawn at one size, so every button lines up (text glyphs like ⟲ render tiny and uneven). */
const ICON = {
  play: `<svg viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor"/></svg>`,
  restart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>`,
  gear: `<svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M10.3 2h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9L2 13.7v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>`,
};

const STYLE = `
#menu { position: fixed; z-index: 40; display: grid; place-items: center; background: rgba(17,20,58,.55); backdrop-filter: blur(2px);
  font-family: "Arial Rounded MT Bold", "Avenir Next", Arial, sans-serif; color: #f4f1ea; animation: mn-fade .2s ease-out; }
#menu .card { position: relative; width: min(420px, 86%); padding: 26px 26px 22px; border-radius: 26px; background: #1b1f4b; text-align: center;
  box-shadow: 0 10px 0 #0b0d2a, 0 30px 60px #0008; animation: mn-pop .35s cubic-bezier(.3,1.5,.5,1); overflow: hidden; }
#menu .card::before { content: ""; position: absolute; left: 50%; top: 0; width: 90px; height: 6px; margin-left: -45px; border-radius: 0 0 6px 6px; background: #ff5e7e; }
#menu h1 { margin: 6px 0 4px; font-size: 34px; letter-spacing: 2px; color: #ffd23f; }
#menu p { margin: 0 0 18px; font: 600 13px "Avenir Next", Arial; color: #aab0e6; }
#menu button { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; margin: 8px 0 0; padding: 13px; border: 0; border-radius: 14px; cursor: pointer; font: 900 15px "Avenir Next", Arial;
  letter-spacing: .5px; transition: transform .1s, filter .15s; }
#menu button:hover { filter: brightness(1.1); } #menu button:active { transform: translateY(3px); }
#menu .primary { background: #2ec4b6; color: #11143a; box-shadow: 0 4px 0 #1a7f76; }
#menu .secondary { background: #ffd23f; color: #11143a; box-shadow: 0 4px 0 #b88f00; }
#menu .plain { background: #ffffff14; color: #f4f1ea; }
#menu kbd { margin-left: 2px; padding: 1px 6px; border-radius: 5px; background: #0002; font: 700 11px Menlo, monospace; }
#menu .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 12px 0; text-align: left; font: 700 14px "Avenir Next", Arial; }
#menu .row small { display: block; font: 600 11px "Avenir Next", Arial; color: #8a90cc; }
#menu .seg { display: flex; background: #11143a; border-radius: 999px; padding: 3px; flex: none; }
#menu button svg { width: 20px; height: 20px; flex: none; }
#menu .seg button { width: auto; margin: 0; padding: 6px 12px; border-radius: 999px; font: 800 12px "Avenir Next", Arial; background: none; color: #aab0e6; box-shadow: none; }
#menu .seg button.on { background: #2ec4b6; color: #11143a; }
#menu .note { margin-top: 10px; font: 600 11px "Avenir Next", Arial; color: #8a90cc; }
@keyframes mn-fade { from { opacity: 0; } }
@keyframes mn-pop { from { opacity: 0; transform: scale(.85) translateY(20px); } }
`;

let root: HTMLDivElement | null = null;

export function closeMenu() {
  root?.remove();
  root = null;
}

export function menuOpen() {
  return !!root;
}

export function openMenu(game: Phaser.Game, opts: MenuOptions) {
  if (!document.getElementById("menu-style")) {
    const css = document.createElement("style");
    css.id = "menu-style";
    css.textContent = STYLE;
    document.head.append(css);
  }
  closeMenu();
  root = document.createElement("div");
  root.id = "menu";
  const r = game.canvas.getBoundingClientRect();
  Object.assign(root.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  // the menu's clicks are its own: they must not reach the game (shooting) underneath
  for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "contextmenu"]) root.addEventListener(type, (e) => e.stopPropagation());
  document.body.append(root);
  showMain(opts);
}

function card(html: string) {
  root!.innerHTML = `<div class="card">${html}</div>`;
  return root!.querySelector<HTMLElement>(".card")!;
}

function showMain(opts: MenuOptions) {
  const c = card(`
    <h1></h1><p></p>
    ${opts.onResume ? `<button class="primary" data-act="resume">${ICON.play}Resume<kbd>P</kbd></button>` : ""}
    <button class="${opts.onResume ? "secondary" : "primary"}" data-act="new">${ICON.restart}${opts.onResume ? "New game" : "Play again"}<kbd>R</kbd></button>
    <button class="plain" data-act="settings">${ICON.gear}Settings</button>`);
  c.querySelector("h1")!.textContent = opts.title;
  c.querySelector("p")!.textContent = opts.subtitle;
  c.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "new" || act === "settings") audio.play("click");
    if (act === "resume") opts.onResume?.();
    if (act === "new") opts.onNewGame();
    if (act === "settings") showSettings(opts);
  });
}

function showSettings(opts: MenuOptions) {
  const seg = (key: string, values: [string, string][], current: string) =>
    `<div class="seg" data-key="${key}">${values.map(([v, label]) => `<button data-v="${v}" class="${v === current ? "on" : ""}">${label}</button>`).join("")}</div>`;
  const onOff = (key: keyof typeof settings) => seg(key, [["on", "On"], ["off", "Off"]], settings[key] ? "on" : "off");
  const c = card(`
    <h1>SETTINGS</h1><p>For this session · nothing is saved</p>
    <div class="row"><div>Difficulty<small>lives and how often enemies shoot</small></div>${seg("difficulty", [["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]], settings.difficulty)}</div>
    <div class="row"><div>Line of sight<small>darkness behind walls</small></div>${onOff("lineOfSight")}</div>
    <div class="row"><div>Screen shake</div>${onOff("screenShake")}</div>
    <div class="row"><div>Pause when away<small>when the window loses focus</small></div>${onOff("pauseOnBlur")}</div>
    <div class="row"><div>Sound<small>or press M any time</small></div>${onOff("sound")}</div>
    <div class="row"><div>Volume<small>sound effects</small></div>${seg("volume", [["low", "Low"], ["medium", "Medium"], ["high", "High"]], settings.volume)}</div>
    <div class="row"><div>Music</div>${seg("music", [["off", "Off"], ["low", "Low"], ["medium", "Med"], ["high", "High"]], settings.music)}</div>
    <div class="note">Difficulty applies from the next new game.</div>
    <button class="plain" data-act="back">${ICON.back}Back</button>`);
  c.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-act=back]")) { audio.play("click"); return showMain(opts); }
    const b = t.closest<HTMLElement>("[data-v]"), group = b?.parentElement as HTMLElement | null;
    if (!b || !group?.dataset.key) return;
    const key = group.dataset.key as keyof typeof settings, v = b.dataset.v!;
    if (key === "difficulty") settings.difficulty = v as Difficulty;
    else if (key === "volume") settings.volume = v as typeof settings.volume;
    else if (key === "music") settings.music = v as typeof settings.music;
    else (settings as Record<string, unknown>)[key] = v === "on";
    group.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    audio.applySettings();
    audio.play("click"); // also a preview of the new volume
  });
}
