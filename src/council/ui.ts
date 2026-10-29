import Phaser from "phaser";
import { VIEW_W } from "../config";
import type { Level } from "../levelFormat";
import { buildPrompt } from "../oracle/prompt";
import { applyReply, parseReply } from "../oracle/reply";
import { checkLevel } from "../rules";
import type { GameScene } from "../scenes/GameScene";
import { audio } from "../audio";
import { callAgent } from "./agent";
import { GODS, POWERS, PRANKS, type Decree, type GodName, type Power } from "./catalog";
import { cloudBank, godSvg, SCALES } from "./gods";
import { performDecree, performPrank } from "./powers";
import { buildCouncilPrompt, type CouncilHistory } from "./prompt";
import { readDecree } from "./reply";
import { localCouncil } from "./local";
import { settings } from "../settings";

// The Council of the Gods (press E). Time stops, the Hall of Ma'at descends, and you make a wish.
// The scales weigh it (a 50/50 roll, decided when you ask); the agent (Claude Code, headless) is told the
// verdict, reads the live game, and answers as one of the gods with powers from catalog.ts. A grant plays
// out in the live game (powers.ts); a refusal is funny, sometimes with a harmless prank.

const ORDER: GodName[] = ["anubis", "thoth", "ra", "bastet", "sobek"];
/** Distant peaks rising out of the sea of clouds, flat and lit from the left. */
const MOUNTAINS = `<svg viewBox="0 0 1000 240" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 240 L90 120 L150 165 L250 60 L340 150 L420 110 L500 30 L590 125 L660 90 L760 170 L850 70 L930 140 L1000 100 L1000 240Z" fill="#e7a98c"/>
  <path d="M250 60 L340 150 L300 240 L250 240Z M500 30 L590 125 L540 240 L500 240Z M850 70 L930 140 L890 240 L850 240Z" fill="#d48f7a"/>
  <path d="M250 60 L272 82 L258 90 L244 80 L232 84Z M500 30 L524 54 L508 62 L494 52 L480 56Z M850 70 L872 92 L858 100 L844 90 L832 94Z" fill="#fff6e6"/>
  <path d="M0 240 L60 190 L130 220 L210 160 L300 215 L380 175 L470 220 L560 180 L650 215 L740 170 L830 210 L920 180 L1000 205 L1000 240Z" fill="#f0b796"/>
</svg>`;

const CHORUS = { grant: ["SO BE IT!", "YES!", "DIVINE!", "Ugh, fine.", "WITNESSED."], refuse: ["HA!", "LOL. No.", "HAHAHA", "Denied!", "Next!"] };
const pad = (n: number) => String(n).padStart(3, "0");

const STYLE = `
#council { --navy:#1b1f4b; --deep:#11143a; --violet:#6c5ce7; --teal:#2ec4b6; --pink:#ff5e7e; --yellow:#ffd23f; --orange:#ff9f1c; --ink:#f4f1ea; --brown:#7a3510;
  position: fixed; z-index: 30; overflow: hidden; font-family: "Arial Rounded MT Bold", "Avenir Next", Arial, sans-serif; color: var(--ink); pointer-events: auto; }
#council * { box-sizing: border-box; }
#council .flash { position: absolute; inset: 0; background: #fffbe6; opacity: 0; animation: cn-thunder .7s ease-out; pointer-events: none; z-index: 9; }
#council .sky { position: absolute; inset: 0; overflow: hidden; animation: cn-open 1s cubic-bezier(.3,.7,.2,1) both;
  background: linear-gradient(#fff3c4 0%, #ffdc94 34%, #f9bd80 56%, #f2a679 70%, #f2a679 100%); }
#council .sun { position: absolute; left: 50%; top: 31%; width: 34%; aspect-ratio: 1; transform: translate(-50%, -50%); border-radius: 50%;
  animation: cn-sunrise 1.1s .15s cubic-bezier(.2,.9,.3,1) both;
  background: #fff6cf; box-shadow: 0 0 0 22px #ffe99066, 0 0 0 54px #ffe07030, 0 0 140px 60px #fff2b0; }
#council .rays { position: absolute; left: 50%; top: 31%; width: 2200px; height: 2200px; margin: -1100px 0 0 -1100px; border-radius: 50%; opacity: .5;
  background: repeating-conic-gradient(#fff8d8 0 6deg, transparent 6deg 16deg); animation: cn-spin 60s linear infinite, cn-bloom 1.2s .35s cubic-bezier(.2,.9,.3,1) both;
  mask-image: radial-gradient(circle, #000 0, #000 12%, transparent 45%); }
#council .mountains { position: absolute; left: -2%; right: -2%; bottom: 40%; height: 24%; animation: cn-rise-up .9s .3s cubic-bezier(.2,.9,.3,1) both; }
#council .mountains svg { width: 100%; height: 100%; display: block; }
#council .bank { display: block; width: 100%; height: auto; overflow: visible; }
#council .sea { position: absolute; left: -8%; right: -8%; }
#council .sea.r1 { bottom: 37%; opacity: .95; animation: cn-drift 12s ease-in-out infinite alternate, cn-from-left 1s .2s cubic-bezier(.2,.9,.3,1) both; }
#council .sea.r2 { bottom: 16%; animation: cn-drift 9s ease-in-out infinite alternate-reverse, cn-from-right 1s .3s cubic-bezier(.2,.9,.3,1) both; }
#council .sea.r3 { bottom: -12%; animation: cn-drift 10s ease-in-out infinite alternate, cn-from-below .9s .4s cubic-bezier(.2,.9,.3,1) both; filter: drop-shadow(0 -6px 12px rgba(122,53,16,.15)); }
/* the council: Ra at the far end, two gods down each side like a meeting room */
#council .seat { position: absolute; text-align: center; }
#council .seat[data-god=ra] { left: 50%; bottom: 41%; width: 19%; margin-left: -9.5%; z-index: 2; }
#council .seat[data-god=thoth] { left: 20%; bottom: 31%; width: 13.5%; z-index: 3; }
#council .seat[data-god=bastet] { right: 20%; bottom: 31%; width: 13.5%; z-index: 3; }
#council .seat[data-god=anubis] { left: 1.5%; bottom: 20%; width: 19%; z-index: 4; }
#council .seat[data-god=sobek] { right: 1.5%; bottom: 20%; width: 19%; z-index: 4; }
#council .seat.r .art { transform: scaleX(-1); } /* the right side faces the middle */
#council .seat .pad { position: absolute; left: -22%; right: -22%; bottom: -14%; z-index: 2; filter: drop-shadow(0 8px 10px rgba(122,53,16,.2)); }
#council .god { position: relative; animation: cn-float-in .7s cubic-bezier(.3,1.5,.5,1) both; transition: transform .35s cubic-bezier(.3,1.6,.5,1), filter .3s; }
#council .god .god-art { width: 100%; display: block; overflow: visible; filter: drop-shadow(0 6px 0 rgba(122,53,16,.18)); }
#council .god .plate { position: absolute; left: 50%; bottom: 3%; transform: translateX(-50%); z-index: 4; padding: 2px 9px; border-radius: 999px; font-size: 10px;
  letter-spacing: 1.5px; color: var(--deep); box-shadow: 0 3px 0 #0003; white-space: nowrap; }
#council .god .say { position: absolute; left: 50%; bottom: 96%; transform: translateX(-50%) scale(0); transform-origin: 50% 100%; width: max-content; max-width: 210%;
  padding: 7px 11px; border-radius: 16px; background: var(--ink); color: var(--navy); font-size: 12px; line-height: 1.25; box-shadow: 0 4px 0 #c9c3b3; z-index: 6;
  transition: transform .3s cubic-bezier(.3,1.7,.5,1); }
#council .god .say::after { content: ""; position: absolute; left: 50%; bottom: -8px; margin-left: -8px; border: 8px solid transparent; border-top-color: var(--ink); border-bottom: 0; }
#council .god .say.on { transform: translateX(-50%) scale(1); }
#council .god .say.shout { background: var(--yellow); font-size: 15px; letter-spacing: 1px; }
#council .god .say.shout::after { border-top-color: var(--yellow); }
#council.deliberating .god .head { animation: cn-nod 1.4s ease-in-out infinite; transform-origin: 60px 90px; }
#council.deliberating .seat[data-god=thoth] .head, #council.deliberating .seat[data-god=sobek] .head { animation-delay: .45s; }
#council .god.speaking { transform: translateY(-10%) scale(1.14) !important; filter: drop-shadow(0 0 26px var(--glow)); z-index: 5; }
#council .god.speaking .arm { animation: cn-wave .5s ease-in-out 4; transform-origin: 90px 108px; }
#council.refused .god:not(.speaking) .head { animation: cn-laugh .3s ease-in-out 8; transform-origin: 60px 90px; }
#council.granted .god:not(.speaking) .god-art { animation: cn-cheer .45s ease-in-out 2; }
#council .bob { animation: cn-bob 2.4s ease-in-out infinite; }
#council .seat[data-god=thoth] .bob { animation-delay: .4s; } #council .seat[data-god=ra] .bob { animation-delay: .9s; }
#council .seat[data-god=bastet] .bob { animation-delay: 1.3s; } #council .seat[data-god=sobek] .bob { animation-delay: 1.7s; }
#council .lid { transform-box: fill-box; transform-origin: center; transform: scaleY(0); animation: cn-blink 5s infinite; }
#council .god[data-god=anubis] .lid { fill: #2a2d5c; animation-delay: .7s; } #council .god[data-god=thoth] .lid { fill: #f4f1ea; animation-delay: 2.1s; }
#council .god[data-god=ra] .lid { fill: #c97b3d; } #council .god[data-god=bastet] .lid { fill: #ff5e7e; animation-delay: 3.3s; } #council .god[data-god=sobek] .lid { fill: #1fb5a8; animation-delay: 1.2s; }
#council .halo { animation: cn-spin 12s linear infinite; transform-box: fill-box; transform-origin: center; }
#council .center { position: absolute; left: 50%; top: 58%; transform: translateX(-50%); width: 300px; text-align: center; opacity: 0; animation: cn-fade .4s 1s forwards; z-index: 4; }
#council .scales { width: 150px; overflow: visible; filter: drop-shadow(0 4px 0 rgba(122,53,16,.25)); }
#council .beam { transform-origin: 110px 36px; transition: transform 1s cubic-bezier(.3,1.6,.4,1); }
#council.deliberating .beam { animation: cn-wobble 1.2s ease-in-out infinite; }
#council .scales[data-tilt=grant] .beam { transform: rotate(-16deg); }
#council .scales[data-tilt=refuse] .beam { transform: rotate(16deg); }
#council .ring { position: absolute; left: 50%; top: -10px; width: 130px; height: 130px; transform: translateX(-50%); display: none; }
#council.deliberating .ring { display: block; }
#council .ring circle { fill: none; stroke-width: 6; stroke-linecap: round; }
#council .ring .track { stroke: #ffffff66; } #council .ring .bar { stroke: #ff9f1c; transform: rotate(-90deg); transform-origin: 50% 50%; }
#council .verdict-banner { position: absolute; left: 0; right: 0; top: 50%; height: 0; display: flex; align-items: center; justify-content: center; gap: 18px;
  overflow: hidden; z-index: 7; transform: translateY(-50%); transition: height .35s cubic-bezier(.3,1.5,.5,1); box-shadow: 0 10px 0 #0003; }
#council .verdict-banner b { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; font-size: 40px; background: #fff; }
#council .verdict-banner span { font-size: 54px; letter-spacing: 10px; color: #fff; text-shadow: 0 5px 0 #0003; }
#council.granted .verdict-banner { background: #2ec4b6; } #council.granted .verdict-banner b { color: #0e8f84; }
#council.refused .verdict-banner { background: #ff5e7e; } #council.refused .verdict-banner b { color: #e0315a; }
#council .verdict-banner.show { height: 110px; animation: cn-hold 1.5s forwards; }
#council.granted .flash { background: #2ec4b6; } #council.refused .flash { background: #ff5e7e; }
@keyframes cn-hold { 0%, 80% { opacity: 1; } 100% { opacity: 0; } }
#council .bubble { position: absolute; left: 50%; top: 79%; transform: translateX(-50%); width: max-content; max-width: 74%; padding: 14px 20px; border-radius: 22px; background: var(--ink);
  color: var(--navy); font-size: 17px; line-height: 1.35; text-align: center; box-shadow: 0 6px 0 #c9c3b3, 0 18px 40px rgba(17,20,58,.35); display: none; z-index: 6; }
#council .bubble.show { display: block; animation: cn-pop .45s cubic-bezier(.3,1.7,.5,1) both; }
#council .bubble small { display: block; font-size: 11px; letter-spacing: 2px; margin-bottom: 4px; }
#council .acts { display: flex; flex-wrap: wrap; justify-content: center; gap: 5px; margin-top: 8px; }
#council .acts span { padding: 4px 10px; border-radius: 999px; font-size: 12px; color: var(--deep); animation: cn-pop .35s cubic-bezier(.3,1.6,.5,1) both; box-shadow: 0 3px 0 #0004; }
#council .cancel { display: none; margin: 6px auto 0; border: 0; cursor: pointer; padding: 5px 14px; border-radius: 999px; background: #11143acc; color: #fff; font: 700 11px "Avenir Next", Arial; }
#council.deliberating .cancel { display: inline-block; }
#council .dock { position: absolute; left: 50%; bottom: 6%; width: min(600px, 86%); transform: translateX(-50%); animation: cn-up .55s .9s cubic-bezier(.2,1.3,.4,1) both; z-index: 5; }
#council .askbox { display: flex; align-items: center; background: #11143aee; border-radius: 20px; padding: 6px 6px 6px 18px; box-shadow: 0 6px 0 #0b0d2a, 0 0 0 3px #ffd23f, 0 0 40px #ffd23f88; }
#council .askbox input { font: 600 17px "Avenir Next", Arial; padding: 11px 0; border: 0; background: none; width: 100%; color: #fff; outline: none; caret-color: var(--yellow); }
#council .askbox input::placeholder { color: #ffffff66; }
#council .askbox button svg { width: 18px; height: 18px; }
#council .askbox button { display: flex; align-items: center; gap: 6px; flex: none; height: 44px; padding: 0 16px; border-radius: 14px; border: 0; cursor: pointer; background: var(--yellow); color: var(--navy); font: 900 14px "Avenir Next", Arial; box-shadow: 0 4px 0 #b88f00; }
#council .hint { margin-top: 8px; text-align: center; font: 600 11px "Avenir Next", Arial; color: #fff; text-shadow: 0 1px 2px #11143a; }
#council kbd { font: 700 10px Menlo, monospace; padding: 1px 5px; border-radius: 5px; background: #11143a99; color: #fff; }
#council.deliberating .dock, #council.verdict .dock { opacity: 0; pointer-events: none; transform: translate(-50%, 30px); transition: all .3s; }
/* leaving: the entrance in reverse. Gods first, then the clouds roll away, the land and sun go down, the light closes */
#council.leaving .seat, #council.leaving .center, #council.leaving .dock, #council.leaving .bubble { animation: cn-gods-out .3s cubic-bezier(.6,0,.8,.3) forwards; }
#council.leaving .sea.r3 { animation: cn-to-below .45s .1s cubic-bezier(.6,0,.8,.3) forwards; }
#council.leaving .sea.r2 { animation: cn-to-right .45s .18s cubic-bezier(.6,0,.8,.3) forwards; }
#council.leaving .sea.r1 { animation: cn-to-left .45s .26s cubic-bezier(.6,0,.8,.3) forwards; }
#council.leaving .mountains { animation: cn-to-below .4s .3s cubic-bezier(.6,0,.8,.3) forwards; }
#council.leaving .rays { animation: cn-unbloom .4s .3s cubic-bezier(.6,0,.8,.3) forwards; }
#council.leaving .sun { animation: cn-sunset .45s .35s cubic-bezier(.6,0,.8,.3) forwards; }
#council.leaving .sky { animation: cn-close .5s .5s cubic-bezier(.6,0,.8,.3) forwards; }
#cameo { position: fixed; z-index: 25; pointer-events: none; overflow: hidden; }
#cameo .peek { position: absolute; right: 3%; top: 7%; width: 17%; max-width: 160px; transform: translateY(-140%); transition: transform .6s cubic-bezier(.3,1.5,.5,1); }
#cameo.on .peek { transform: none; }
#cameo .peek .god-art { position: relative; width: 100%; filter: drop-shadow(0 6px 0 rgba(122,53,16,.2)); }
#cameo .peek .cloud { position: absolute; left: -25%; right: -25%; bottom: -6%; height: 42%; z-index: 2; }
#cameo .peek .cloud .bank { position: absolute; bottom: 0; width: 100%; height: auto; overflow: visible; filter: drop-shadow(0 8px 10px rgba(122,53,16,.25)); }
#cameo .bob { animation: cn-bob 1.6s ease-in-out infinite; }
#cameo .halo { animation: cn-spin 8s linear infinite; transform-box: fill-box; transform-origin: center; }
canvas.cn-frozen { filter: sepia(.45) saturate(1.35) brightness(1.06) contrast(1.04); }
canvas.cn-fading { transition: filter .5s ease-out; }
#game.cn-quake { animation: cn-quake .5s linear; }
@keyframes cn-open { from { clip-path: circle(0% at 50% 100%); } to { clip-path: circle(150% at 50% 100%); } }
@keyframes cn-close { from { clip-path: circle(150% at 50% 100%); } to { clip-path: circle(0% at 50% 100%); } }
@keyframes cn-sunrise { from { translate: 0 70%; scale: .7; } to { translate: 0 0; scale: 1; } }
@keyframes cn-sunset { to { translate: 0 80%; scale: .6; opacity: 0; } }
@keyframes cn-bloom { from { scale: .3; opacity: 0; } to { scale: 1; opacity: .5; } }
@keyframes cn-rise-up { from { translate: 0 60%; opacity: 0; } to { translate: 0 0; opacity: 1; } }
@keyframes cn-from-left { from { translate: -70% 0; opacity: 0; } to { translate: 0 0; opacity: 1; } }
@keyframes cn-from-right { from { translate: 70% 0; opacity: 0; } to { translate: 0 0; opacity: 1; } }
@keyframes cn-from-below { from { translate: 0 80%; } to { translate: 0 0; } }
@keyframes cn-gods-out { to { translate: 0 40%; scale: .85; opacity: 0; } }
@keyframes cn-unbloom { to { scale: .3; opacity: 0; } }
@keyframes cn-to-left { to { translate: -80% 0; opacity: 0; } }
@keyframes cn-to-right { to { translate: 80% 0; opacity: 0; } }
@keyframes cn-to-below { to { translate: 0 90%; opacity: 0; } }
@keyframes cn-float-in { from { transform: translateY(40%) scale(.85); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes cn-thunder { 0% { opacity: 0; } 8% { opacity: .95; } 20% { opacity: .1; } 30% { opacity: .8; } 100% { opacity: 0; } }
@keyframes cn-quake { 10%, 50%, 90% { transform: translate(-6px, 3px); } 30%, 70% { transform: translate(6px, -3px); } }
@keyframes cn-drop { to { transform: none; } } @keyframes cn-lift { from { transform: none; } to { transform: translateY(-115%); } }
@keyframes cn-slam { 0% { transform: translateY(95%); } 100% { transform: none; } }
@keyframes cn-rays { to { opacity: .55; } }
@keyframes cn-pop { from { opacity: 0; transform: translateX(-50%) scale(.5); } to { opacity: 1; transform: translateX(-50%) scale(1); } }
@keyframes cn-up { from { opacity: 0; transform: translate(-50%, 60px); } }
@keyframes cn-fade { to { opacity: 1; } } @keyframes cn-out { to { opacity: 0; } }
@keyframes cn-drift { to { transform: translateX(22px); } }
@keyframes cn-bob { 50% { transform: translateY(-5px); } }
@keyframes cn-blink { 0%, 95%, 100% { transform: scaleY(0); } 97% { transform: scaleY(1); } }
@keyframes cn-spin { to { transform: rotate(360deg); } }
@keyframes cn-nod { 25% { transform: rotate(-8deg); } 75% { transform: rotate(7deg); } }
@keyframes cn-laugh { 50% { transform: rotate(-12deg) translateY(-4px); } }
@keyframes cn-cheer { 50% { transform: translateY(-12%); } }
@keyframes cn-wave { 50% { transform: rotate(-45deg); } }
@keyframes cn-wobble { 0%, 100% { transform: rotate(-10deg); } 50% { transform: rotate(10deg); } }

`;

export class Council {
  private root?: HTMLDivElement;
  private input!: HTMLInputElement;
  private state: "closed" | "asking" | "deliberating" | "verdict" | "leaving" = "closed";
  private abort: AbortController | null = null;
  private readonly model = "sonnet"; // fast
  // kept in memory only: every run starts fresh (nothing is saved to disk or the browser)
  private times: Record<string, number[]> = {};
  private wishes: string[] = [];
  private history: CouncilHistory[] = [];
  private wishIndex = -1;
  private pending: { decree: Decree; granted: boolean } | null = null;

  constructor(private game: Phaser.Game) {
    const css = document.createElement("style");
    css.textContent = STYLE;
    document.head.append(css);
    window.addEventListener("keydown", (e) => this.onKey(e), true);
    window.addEventListener("resize", () => this.place());
  }

  private get scene() {
    return this.game.scene.getScene("game") as GameScene;
  }

  // ---------------------------------------------------------------- open: time stops, the hall descends

  open() {
    const gs = this.scene;
    if (this.state !== "closed" || !gs || !this.game.scene.isActive("game") || gs.cinematic || !gs.snapshot()) return;
    this.state = "asking";
    audio.play("councilOpen");
    audio.setMood("council");
    this.game.registry.set("timeStopped", true); // the HUD and game honour this flag
    this.game.scene.pause("game");
    const canvas = this.game.canvas;
    canvas.classList.add("cn-fading");
    requestAnimationFrame(() => canvas.classList.add("cn-frozen"));

    const root = (this.root = document.createElement("div"));
    root.id = "council";
    const seed = Math.floor(Math.random() * 1e6) + 1;
    const far = cloudBank({ width: 1700, height: 190, seed, tones: ["#e9a060", "#f6c88e", "#fde3bb"] });
    const back = cloudBank({ width: 1600, height: 200, seed: seed + 7, tones: ["#eba66a", "#fbdcae", "#fff4de"], shadow: "#c9783a" });
    const front = cloudBank({ width: 1500, height: 180, seed: seed + 13, tones: ["#eeae72", "#fde6c4", "#ffffff"], shadow: "#b8642e" });
    root.innerHTML = `
      <div class="sky">
        <div class="rays"></div><div class="sun"></div>
        <div class="mountains">${MOUNTAINS}</div>
        <div class="sea r1">${far}</div>
        <div class="sea r2">${back}</div>
      </div>
      ${ORDER.map((g, i) => `
        <div class="seat ${g === "bastet" || g === "sobek" ? "r" : ""}" data-god="${g}">
          <div class="god" data-god="${g}" style="animation-delay:${0.7 + [0.25, 0.15, 0.05, 0.15, 0.25][i]}s;--glow:${GODS[g].color}">
            <div class="say"></div><div class="art">${godSvg(g)}</div>
            <span class="plate" style="background:${GODS[g].color}">${GODS[g].name.toUpperCase()}</span>
            <div class="pad">${cloudBank({ width: 300, height: 90, seed: seed + i * 31, tones: ["#eeae72", "#fde6c4", "#ffffff"], shadow: "#b8642e" })}</div>
          </div>
        </div>`).join("")}
      <div class="sea r3">${front}</div>
      <div class="center">
        <svg class="ring" viewBox="0 0 150 150"><circle class="track" cx="75" cy="75" r="70"/><circle class="bar" cx="75" cy="75" r="70" stroke-dasharray="440" stroke-dashoffset="440"/></svg>
        ${SCALES}
        <div class="acts"></div>
        <button class="cancel" data-act="cancel">Cancel <kbd>Esc</kbd></button>
      </div>
      <div class="bubble"></div>
      <div class="dock">
        <div class="askbox"><input spellcheck="false" placeholder="Speak your wish, mortal…"><button data-act="ask">WISH <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></button></div>
        <div class="hint"><kbd>Enter</kbd> wish · <kbd>Esc</kbd> leave</div>
      </div>
      <div class="verdict-banner"><b></b><span></span></div>
      <div class="flash"></div>`;
    // a thunderclap as the heavens open
    const gameEl = document.getElementById("game");
    gameEl?.classList.add("cn-quake");
    setTimeout(() => gameEl?.classList.remove("cn-quake"), 550);
    document.body.append(root);
    this.input = root.querySelector(".askbox input")!;
    this.place();
    for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "wheel", "contextmenu"]) root.addEventListener(type, (e) => e.stopPropagation());
    root.addEventListener("click", (e) => this.onClick(e));
    this.input.addEventListener("input", () => { this.wishIndex = -1; });
    setTimeout(() => this.input?.focus(), 500);
  }

  private place() {
    if (!this.root) return;
    const r = this.game.canvas.getBoundingClientRect();
    Object.assign(this.root.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, fontSize: `${Math.max(0.7, r.width / VIEW_W)}em` });
  }

  private avg(model: string) {
    const t = this.times[model] ?? [];
    return t.length ? t.reduce((a, b) => a + b, 0) / t.length : model === "sonnet" ? 15000 : 40000;
  }

  // ---------------------------------------------------------------- input

  private onClick(e: Event) {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "ask") void this.ask();
    if (act === "cancel") this.cancel();
  }

  private onKey(e: KeyboardEvent) {
    const k = e.key, target = e.target as HTMLElement;
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (this.state === "closed") {
      if ((k === "e" || k === "E") && !e.repeat && target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") { stop(); this.open(); }
      return;
    }
    if (this.state === "leaving") { stop(); return; }
    if (target.tagName === "TEXTAREA") return;
    if (this.state === "deliberating") { stop(); if (k === "Escape") this.cancel(); return; }
    if (this.state === "verdict") { stop(); if (k === "Enter" || k === "Escape" || k === " ") this.proceed(); return; }
    // asking
    e.stopImmediatePropagation(); // every key belongs to the council now
    if (k === "Escape") { e.preventDefault(); this.close(); return; }
    if (target !== this.input) { if (k.length === 1 || k === "Enter") this.input.focus(); return; }
    if (k === "Enter") { e.preventDefault(); void this.ask(); }
    else if (k === "ArrowUp" && this.wishes.length) {
      e.preventDefault();
      this.wishIndex = Math.min(this.wishes.length - 1, this.wishIndex + 1);
      this.input.value = this.wishes[this.wishes.length - 1 - this.wishIndex];
    }
  }

  // ---------------------------------------------------------------- the wish: roll, deliberate, read

  private async ask() {
    const wish = this.input.value.trim().slice(0, 300);
    if (!wish || this.state !== "asking") return;
    this.wishes = [...this.wishes.filter((w) => w !== wish), wish].slice(-30);
    const force = this.game.registry.get("councilForce") as string | undefined; // console: game.registry.set("councilForce", "grant"|"refuse")
    const granted = force ? force === "grant" : Math.random() < 0.9; // the scales of Ma'at: they refuse one wish in ten
    const world = this.scene.worldSnapshot();
    const pasted = ((this.game.registry.get("councilPaste") as string | undefined) ?? "").trim(); // console: skip the agent

    this.state = "deliberating";
    audio.play("wish");
    this.root!.className = "deliberating";
    const started = performance.now(), expected = !pasted && settings.wishes === "model" ? 900 : this.avg(this.model);
    const bar = this.root!.querySelector<SVGCircleElement>(".ring .bar")!;
    const tick = window.setInterval(() => {
      const t = performance.now() - started;
      bar.style.strokeDashoffset = String(440 * (1 - Math.min(0.96, 1 - Math.exp(-t / (expected * 0.6)))));
    }, 100);

    let text = pasted, ms = 0;
    if (!pasted && settings.wishes === "model") {
      // Instant, in the browser; a short pause so the council still seems to deliberate.
      [text] = await Promise.all([localCouncil(wish, world, granted), new Promise((done) => setTimeout(done, 900))]);
    } else if (!pasted) {
      this.abort = new AbortController();
      const result = await callAgent(buildCouncilPrompt({ wish, granted, world, history: this.history }), this.model, () => {}, this.abort.signal);
      this.abort = null;
      if (!result.ok) {
        clearInterval(tick);
        if (result.cancelled) return;
        return this.showError(result.error);
      }
      text = result.text;
      ms = result.ms;
      (this.times[this.model] ??= []).push(ms);
      this.times[this.model] = this.times[this.model].slice(-8);
    }
    clearInterval(tick);
    const { decree } = readDecree(text, world, granted); // invalid powers were already dropped
    if (!granted && !decree.prank && Math.random() < 0.4) decree.prank = PRANKS[Math.floor(Math.random() * PRANKS.length)];
    const outcome = granted ? `granted: ${decree.actions.map((a) => a.power).join(", ") || "nothing usable"}` : `refused${decree.prank ? ` (prank: ${decree.prank})` : ""}`;
    this.history = [...this.history, { wish, outcome }].slice(-5);
    this.showVerdict(decree, granted);
  }

  /** A speech bubble over one god for a moment (the agent's words: text only, never HTML). */
  private sayAs(god: GodName, text: string, ms: number, shout = false) {
    const el = this.root?.querySelector<HTMLElement>(`.god[data-god=${god}] .say`);
    if (!el) return;
    el.textContent = text;
    el.className = `say on${shout ? " shout" : ""}`;
    clearTimeout(Number(el.dataset.t));
    el.dataset.t = String(setTimeout(() => el.classList.remove("on"), ms));
  }



  private showVerdict(decree: Decree, granted: boolean) {
    const root = this.root!;
    this.pending = { decree, granted };
    this.state = "verdict";
    root.className = granted ? "verdict granted" : "verdict refused";
    audio.play(granted ? "grant" : "refuse");
    root.querySelector(".scales")!.setAttribute("data-tilt", granted ? "grant" : "refuse");
    // unmistakable: a coloured flash and a full-width banner, then the scene behind it
    const banner = root.querySelector<HTMLElement>(".verdict-banner")!;
    banner.querySelector("b")!.textContent = granted ? "✓" : "✕";
    banner.querySelector("span")!.textContent = granted ? "GRANTED" : "REFUSED";
    banner.classList.add("show");
    const flash = root.querySelector<HTMLElement>(".flash")!;
    flash.style.animation = "none";
    void flash.offsetWidth;
    flash.style.animation = "";
    root.querySelectorAll(".god").forEach((g) => g.classList.toggle("speaking", (g as HTMLElement).dataset.god === decree.speaker));
    root.querySelectorAll<HTMLElement>(".god .say").forEach((el) => el.classList.remove("on"));
    // the chorus reacts, then the others butt in one by one
    const pool = granted ? CHORUS.grant : CHORUS.refuse;
    ORDER.filter((g) => g !== decree.speaker).forEach((g, i) => setTimeout(() => this.sayAs(g, pool[(i + Math.floor(Math.random() * 5)) % pool.length], 900, true), 150 + i * 90));
    decree.asides.forEach((a, i) => setTimeout(() => this.state === "verdict" && this.sayAs(a.god, a.line, 2000), 2300 + i * 1100));
    const bubble = root.querySelector<HTMLElement>(".bubble")!;
    bubble.textContent = ""; // the agent's words: text only, never HTML
    const who = document.createElement("small");
    who.textContent = `${GODS[decree.speaker].name.toUpperCase()} ${GODS[decree.speaker].title.toUpperCase()}`;
    who.style.color = GODS[decree.speaker].color;
    bubble.append(who, document.createTextNode(decree.speech));
    setTimeout(() => bubble.classList.add("show"), 1100);
    const acts = root.querySelector<HTMLElement>(".acts")!;
    acts.innerHTML = "";
    const chip = (label: string, color: string, i: number) => {
      const s = document.createElement("span");
      s.textContent = label;
      s.style.background = color;
      s.style.animationDelay = `${0.3 + i * 0.08}s`;
      acts.append(s);
    };
    decree.actions.forEach((a, i) => chip(describe(a), GODS[POWERS[a.power].god].color, i));
    if (decree.prank) chip(`prank: ${decree.prank}`, "#ffd23f", decree.actions.length);
    // automatic: the gods don't wait forever
    const decided = this.pending;
    setTimeout(() => { if (this.pending === decided && this.state === "verdict") this.proceed(); }, 4300 + decree.asides.length * 1100); // the gods have decided
  }

  /** The agent failed: the gods shrug in a bubble, and the hall lifts on its own. */
  private showError(message: string) {
    const root = this.root!;
    this.state = "verdict";
    this.pending = null;
    root.className = "verdict refused";
    const bubble = root.querySelector<HTMLElement>(".bubble")!;
    bubble.textContent = `The gods are silent. (${message})`;
    bubble.classList.add("show");
    setTimeout(() => { if (this.state === "verdict" && !this.pending) this.close(); }, 3000);
  }

  private cancel() {
    this.abort?.abort();
    this.close();
  }

  // ---------------------------------------------------------------- leave: the hall lifts, time flows, the gods act

  private proceed() {
    const p = this.pending;
    this.pending = null;
    this.close(() => {
      const gs = this.scene;
      if (!p || !gs) return;
      if (p.granted && p.decree.actions.length) {
        const leave = this.cameo(p.decree.speaker);
        void performDecree(gs, p.decree, { reshape: (a) => this.reshape(a) }).finally(leave);
      } else if (p.decree.prank) {
        const leave = this.cameo(p.decree.speaker);
        setTimeout(() => performPrank(this.scene, p.decree.prank!), 300);
        setTimeout(leave, 3500);
      }
    });
  }

  /** The god who spoke stays in the game, peeking down from a cloud at the top while their powers play. */
  private cameo(god: GodName) {
    const el = document.createElement("div");
    el.id = "cameo";
    const r = this.game.canvas.getBoundingClientRect();
    Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const puffs = cloudBank({ width: 300, height: 110, seed: 42, tones: ["#eeae72", "#fde6c4", "#ffffff"], shadow: "#b8642e" });
    el.innerHTML = `<div class="peek">${godSvg(god)}<div class="cloud">${puffs}</div></div>`;
    document.getElementById("cameo")?.remove();
    document.body.append(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("on")));
    return () => { el.classList.remove("on"); setTimeout(() => el.remove(), 700); };
  }

  close(after?: () => void) {
    if (!this.root || this.state === "leaving" || this.state === "closed") return;
    this.state = "leaving";
    audio.play("councilClose");
    audio.leaveCouncil();
    const root = this.root;
    root.classList.add("leaving");
    this.game.canvas.classList.remove("cn-frozen");
    setTimeout(() => {
      root.remove();
      this.root = undefined;
      this.state = "closed";
      this.game.registry.set("timeStopped", false);
      this.game.scene.resume("game");
      after?.();
    }, 1050); // the reverse of the entrance takes about a second
  }

  // ---------------------------------------------------------------- reshape: Thoth's map pipeline (exercise 3)

  /** The world rebuilds around the player with the new rows; this game only (the next one reads the file again). */
  private applyLevel(level: Level) {
    const gs = this.scene;
    this.game.registry.set("level", level);
    if (this.game.scene.isActive("game") || this.game.scene.isPaused("game")) gs.scene.restart({ resume: gs.snapshot() });
  }

  private async reshape(a: Extract<Power, { power: "reshape" }>): Promise<{ ok: boolean; message: string }> {
    const before = this.game.registry.get("level") as Level;
    let problems: string[] | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const prompt = buildPrompt({ level: before, rows: a.rows, layer: "both", request: a.request, history: [], rulesOn: true, problems });
      const result = await callAgent(prompt, this.model, () => {}, new AbortController().signal);
      if (!result.ok) return { ok: false, message: "the papyrus stays blank" };
      const parsed = parseReply(result.text, a.rows, "both");
      if (parsed.ok && parsed.reply.refused) return { ok: false, message: "Thoth declines to write" };
      const after = parsed.ok ? applyReply(before, parsed.reply) : null;
      const failed = after ? checkLevel(before, after, a.rows).filter((c) => !c.ok) : [];
      if (after && !failed.length) {
        this.applyLevel(after); // in memory only: the level file is never written
        return { ok: true, message: "the land obeys" };
      }
      problems = parsed.ok ? failed.map((c) => `${c.label}: ${c.detail}`) : parsed.errors;
    }
    return { ok: false, message: "the carving broke the rules" };
  }
}

function describe(a: Power) {
  const label = POWERS[a.power].label;
  switch (a.power) {
    case "smite": case "entomb": case "banish": case "transform": return `${label} ×${a.targets.length}`;
    case "ascend": return `${label} → ${typeof a.to === "number" ? `row ${pad(a.to)}` : a.to}`;
    case "shield": case "slow_time": case "reveal": return `${label} ${a.seconds}s`;
    case "summon_cats": return `${label} ×${a.n}`;
    case "bless": return `${label}: ${[a.lives && `+${a.lives}☥`, a.sandstorms && `+${a.sandstorms} storms`, a.score && `+${a.score}`].filter(Boolean).join(" ")}`;
    case "reshape": return `${label} ${pad(a.rows[0])}–${pad(a.rows[1])}`;
    default: return label;
  }
}

export function mountCouncil(game: Phaser.Game) {
  return new Council(game);
}
