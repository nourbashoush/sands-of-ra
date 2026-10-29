// Touch controls for phones and tablets, shown only on touch screens (or with ?touch in the URL).
// Twin-stick: the left stick moves, the right stick aims and fires while held. Buttons above the right
// stick throw a sandstorm and summon the gods; the top one pauses. They hide while a menu or the
// council is open, since those are tapped directly.

export const touch = {
  on: typeof window !== "undefined" && (matchMedia("(pointer: coarse)").matches || new URLSearchParams(location.search).has("touch")),
  move: { x: 0, y: 0 }, // -1..1 each
  aim: { x: 0, y: 0 },
  firing: false,
  // set by whoever handles them: the player (storm), the HUD (pause), main.ts (gods)
  storm: () => {},
  pause: () => {},
  gods: () => {},
};

const ICON = {
  storm: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M4 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M6 16h6"/></svg>`,
  gods: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>`,
};

const STYLE = `
#touch { position: fixed; inset: 0; z-index: 20; pointer-events: none; user-select: none; -webkit-user-select: none;
  font: 900 10px "Arial Rounded MT Bold", "Avenir Next", Arial, sans-serif; letter-spacing: 1px; color: #f4f1ea; }
body:has(#menu) #touch, body:has(#council) #touch { display: none; }
#touch .stick { position: absolute; bottom: calc(22px + env(safe-area-inset-bottom)); width: 128px; height: 128px; border-radius: 50%;
  background: #11143a99; box-shadow: inset 0 0 0 2px #ffffff26; pointer-events: auto; touch-action: none; }
#touch .stick.move { left: calc(22px + env(safe-area-inset-left)); }
#touch .stick.aim { right: calc(22px + env(safe-area-inset-right)); }
#touch .knob { position: absolute; left: 50%; top: 50%; width: 54px; height: 54px; margin: -27px; border-radius: 50%; box-shadow: 0 4px 0 #0006; }
#touch .move .knob { background: #2ec4b6; }
#touch .aim .knob { background: #ff5e7e; }
#touch .aim.firing { box-shadow: inset 0 0 0 3px #ff5e7e88; }
#touch button { position: absolute; display: grid; place-items: center; width: 56px; height: 56px; padding: 0; border: 0; border-radius: 50%;
  background: #1b1f4bcc; color: #f4f1ea; box-shadow: 0 4px 0 #0b0d2a; pointer-events: auto; touch-action: none; }
#touch button:active { transform: translateY(3px); box-shadow: 0 1px 0 #0b0d2a; }
#touch button svg { width: 26px; height: 26px; }
#touch button span { position: absolute; top: 100%; margin-top: 6px; text-shadow: 0 1px 2px #000a; }
#touch .storm { right: calc(22px + env(safe-area-inset-right)); bottom: calc(178px + env(safe-area-inset-bottom)); color: #ffd23f; }
#touch .gods { right: calc(96px + env(safe-area-inset-right)); bottom: calc(178px + env(safe-area-inset-bottom)); color: #ffd23f; }
#touch .pause { top: calc(64px + env(safe-area-inset-top)); right: calc(12px + env(safe-area-inset-right)); width: 44px; height: 44px; }
#touch .pause svg { width: 20px; height: 20px; }
/* Upright phone: the game sits at the top and the controls get the space below it, so thumbs never cover it.
   Sideways there's no room to spare, so the controls float over the game's corners. */
@media (orientation: portrait) {
  html.touch #game { height: calc(100% - 260px - env(safe-area-inset-bottom)); padding-top: env(safe-area-inset-top); box-sizing: border-box; }
  #touch .pause { top: auto; right: auto; left: 50%; bottom: calc(58px + env(safe-area-inset-bottom)); margin-left: -22px; }
}
@media (orientation: landscape) {
  #touch .stick { background: #11143a55; }
  #touch .stick.move, #touch .stick.aim { bottom: calc(16px + env(safe-area-inset-bottom)); }
  #touch .storm, #touch .gods { bottom: calc(160px + env(safe-area-inset-bottom)); }
}
`;

// Before the game starts, so it sizes itself to the space above the controls.
if (touch.on) {
  document.documentElement.classList.add("touch");
  const css = document.createElement("style");
  css.textContent = STYLE;
  document.head.append(css);
}

/** A thumbstick: reports where the thumb is, -1..1 on each axis, until it lifts. */
function stick(el: HTMLElement, onChange: (x: number, y: number, held: boolean) => void) {
  const knob = el.querySelector<HTMLElement>(".knob")!;
  let id: number | null = null;
  const update = (e: PointerEvent) => {
    const r = el.getBoundingClientRect(), radius = r.width / 2;
    let x = (e.clientX - r.left - radius) / radius, y = (e.clientY - r.top - radius) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    knob.style.transform = `translate(${x * radius * 0.6}px, ${y * radius * 0.6}px)`;
    onChange(x, y, true);
  };
  const release = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    knob.style.transform = "";
    onChange(0, 0, false);
  };
  el.addEventListener("pointerdown", (e) => {
    if (id !== null) return;
    id = e.pointerId;
    try { el.setPointerCapture(id); } catch { /* the pointer already went away */ }
    update(e);
  });
  el.addEventListener("pointermove", (e) => { if (e.pointerId === id) update(e); });
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
}

export function mountTouch() {
  if (!touch.on) return;

  const root = document.createElement("div");
  root.id = "touch";
  root.innerHTML = `
    <div class="stick move"><div class="knob"></div></div>
    <div class="stick aim"><div class="knob"></div></div>
    <button class="gods" aria-label="Summon the gods">${ICON.gods}<span>GODS</span></button>
    <button class="storm" aria-label="Sandstorm">${ICON.storm}<span>STORM</span></button>
    <button class="pause" aria-label="Pause">${ICON.pause}</button>`;
  document.body.append(root);
  root.addEventListener("contextmenu", (e) => e.preventDefault()); // a long press shouldn't open a menu

  const aim = root.querySelector<HTMLElement>(".aim")!;
  stick(root.querySelector(".move")!, (x, y) => { touch.move = { x, y }; });
  stick(aim, (x, y, held) => {
    touch.aim = { x, y };
    touch.firing = held && Math.hypot(x, y) > 0.3; // a small dead zone: touching the middle doesn't fire
    aim.classList.toggle("firing", touch.firing);
  });
  const tap = (selector: string, action: () => void) =>
    root.querySelector(selector)!.addEventListener("pointerdown", (e) => { e.preventDefault(); action(); });
  tap(".storm", () => touch.storm());
  tap(".gods", () => touch.gods());
  tap(".pause", () => touch.pause());
}
