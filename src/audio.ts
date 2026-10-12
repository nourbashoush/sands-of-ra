import { settings } from "./settings";

// Sound effects synthesised with the Web Audio API: no audio files, no dependencies.
// (Started from the workshop's audio agent, extended for Sands of Ra.) Usage: audio.play("shot").
// The AudioContext starts on the first click or key press (browsers block audio before that).
// Volume and on/off come from the Settings panel (src/settings.ts); M toggles sound too.

export type Sound =
  // the game
  | "shot" | "enemyShot" | "shell" | "lob" | "explosion" | "bigExplosion" | "hit" | "ping" | "enemyDeath"
  | "pickup" | "rescue" | "meow" | "sandstorm" | "playerDeath" | "win" | "gameOver"
  // menus
  | "click" | "pause" | "resume"
  // the council of the gods
  | "councilOpen" | "councilClose" | "wish" | "grant" | "refuse" | "lockOn"
  | "smite" | "entomb" | "banish" | "transform" | "purify" | "shield" | "bless" | "summon"
  | "slowTime" | "reveal" | "sunFall" | "ascend" | "reshape" | "boing" | "ribbit" | "camel"
  // the Pharaoh's chariot
  | "bossHorn" | "bossRoar" | "bossDown" | "hoof" | "wheels";

/** The background music's mood: the desert, the boss fight, or the council in the sky. */
export type Mood = "calm" | "boss" | "council";

const VOLUME = { low: 0.15, medium: 0.32, high: 0.55 } as const;
const MUSIC_VOLUME = { off: 0, low: 0.1, medium: 0.2, high: 0.34 } as const;
/** Minimum milliseconds between two plays of the same sound (rapid fire would clip). */
const THROTTLE_MS: Partial<Record<Sound, number>> = {
  shot: 60, enemyShot: 70, hit: 40, ping: 60, explosion: 50, enemyDeath: 40, meow: 90, lockOn: 80, click: 40,
  hoof: 90, wheels: 500,
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null; // sound effects
let musicBus: GainNode | null = null; // background music
let mainOut: GainNode | null = null; // everything: Sound on/off
/** Where the building blocks send their sound right now (an effect's own gain, or the music bus). */
let out: AudioNode | null = null;
let noiseBuf: AudioBuffer | null = null;
const lastPlayed = new Map<Sound, number>();

const level = () => VOLUME[settings.volume];
const musicLevel = () => MUSIC_VOLUME[settings.music];

function unlock() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    mainOut = ctx.createGain();
    mainOut.gain.value = settings.sound ? 1 : 0;
    comp.connect(mainOut).connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = level();
    master.connect(comp);
    musicBus = ctx.createGain();
    musicBus.gain.value = musicLevel();
    musicBus.connect(comp);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
  startMusic();
}

if (typeof window !== "undefined") {
  for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, unlock, { capture: true });
  // a hidden tab or window makes no sound at all (and a second copy of the game can't play over this one)
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
  window.addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.code === "KeyM" && !e.repeat && tag !== "INPUT" && tag !== "TEXTAREA") audio.toggle();
  });
}

// ---------------------------------------------------------------- building blocks

/** Envelope: attack to `peak`, exponential decay to silence by `dur` seconds. */
function env(t: number, peak: number, dur: number, attack = 0.005): GainNode {
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out ?? master!);
  return g;
}

function tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, attack = 0.005) {
  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  o.connect(env(t, peak, dur, attack));
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(t: number, dur: number, peak: number, filter: BiquadFilterType, f0: number, f1 = f0, q = 0.7, attack = 0.005) {
  const src = ctx!.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const bq = ctx!.createBiquadFilter();
  bq.type = filter;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(f0, t);
  bq.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  src.connect(bq).connect(env(t, peak, dur, attack));
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

/** A plucked harp string: bright attack, quick decay (the game's Egyptian voice). */
function harp(freqs: number[], step: number, t: number, peak = 0.22, ring = 0.5) {
  freqs.forEach((f, i) => { tone("triangle", f, f * 0.995, t + i * step, ring, peak); tone("sine", f * 2, f * 2, t + i * step, ring * 0.5, peak * 0.3); });
}

/** A soft held chord, like a choir: slow attack, slightly detuned voices. */
function choir(freqs: number[], t: number, dur: number, peak = 0.09) {
  for (const f of freqs) for (const d of [-3, 3]) tone("sine", f + d, f + d, t, dur, peak, dur * 0.35);
}

/** A cat: a gliding, wobbly sine. */
function meowAt(t: number, pitch = 1) {
  const o = ctx!.createOscillator(), g = env(t, 0.22, 0.42, 0.03);
  o.type = "sine";
  const curve = new Float32Array([620, 900, 1050, 980, 760, 560].map((f) => f * pitch));
  o.frequency.setValueCurveAtTime(curve, t, 0.4);
  const vib = ctx!.createOscillator(), vibAmt = ctx!.createGain();
  vib.frequency.value = 18;
  vibAmt.gain.value = 22 * pitch;
  vib.connect(vibAmt).connect(o.frequency);
  o.connect(g);
  o.start(t); vib.start(t);
  o.stop(t + 0.45); vib.stop(t + 0.45);
}

// Egyptian-sounding scale (phrygian dominant on E): E F G# A B C D
const E = [329.6, 349.2, 415.3, 440, 493.9, 523.3, 587.3, 659.3, 698.5, 830.6, 880];

const SOUNDS: Record<Sound, (t: number) => void> = {
  // ---- the game
  shot: (t) => { tone("triangle", 1500, 700, t, 0.07, 0.14); noise(t, 0.05, 0.12, "highpass", 3500, 2000); }, // an ankh bolt
  enemyShot: (t) => { noise(t, 0.09, 0.2, "bandpass", 1200, 450, 1.2); tone("sawtooth", 420, 120, t, 0.09, 0.07); }, // a cursed bolt
  shell: (t) => { noise(t, 0.25, 0.45, "lowpass", 1500, 200); tone("sine", 160, 50, t, 0.25, 0.35); },
  lob: (t) => { tone("triangle", 300, 700, t, 0.18, 0.13); noise(t, 0.12, 0.07, "bandpass", 3000, 3000, 2); },
  explosion: (t) => { noise(t, 0.6, 0.75, "lowpass", 2200, 80); tone("sine", 120, 30, t, 0.5, 0.45); },
  bigExplosion: (t) => {
    noise(t, 1.1, 0.95, "lowpass", 1800, 50); tone("sine", 90, 25, t, 0.9, 0.65);
    noise(t + 0.12, 0.6, 0.35, "lowpass", 900, 60);
  },
  hit: (t) => tone("square", 260, 120, t, 0.05, 0.09),
  ping: (t) => tone("triangle", 2200, 1700, t, 0.12, 0.11),
  enemyDeath: (t) => { tone("sawtooth", 420, 70, t, 0.22, 0.13); noise(t, 0.12, 0.13, "bandpass", 800, 300); },
  pickup: (t) => harp([E[3], E[5], E[7]], 0.06, t, 0.2, 0.35),
  rescue: (t) => harp([E[0], E[2], E[3], E[4], E[7], E[10]], 0.07, t, 0.22, 0.6),
  meow: (t) => meowAt(t, 0.85 + Math.random() * 0.4),
  sandstorm: (t) => { noise(t, 1.3, 0.4, "bandpass", 350, 1800, 1.5, 0.15); noise(t, 1.1, 0.25, "lowpass", 300, 120, 0.7, 0.05); },
  playerDeath: (t) => { noise(t, 0.5, 0.55, "lowpass", 1500, 100); tone("square", 600, 60, t, 0.7, 0.18); },
  win: (t) => { harp([E[0], E[3], E[4], E[7], E[10]], 0.12, t, 0.24, 0.9); choir([220, 277.2, 329.6], t + 0.5, 2, 0.08); },
  gameOver: (t) => harp([E[7], E[5], E[3], E[1], E[0]], 0.28, t, 0.22, 0.8),
  // ---- menus
  click: (t) => tone("triangle", 1300, 1100, t, 0.04, 0.12),
  pause: (t) => harp([E[7], E[3]], 0.08, t, 0.16, 0.3),
  resume: (t) => harp([E[3], E[7]], 0.08, t, 0.16, 0.3),
  // ---- the council
  councilOpen: (t) => { noise(t, 1.6, 0.6, "lowpass", 600, 60, 0.7, 0.02); tone("sine", 70, 40, t, 1.2, 0.5); choir([220, 277.2, 329.6, 440], t + 0.35, 2.4, 0.07); }, // thunder, then the hall
  councilClose: (t) => { noise(t, 0.7, 0.25, "bandpass", 1600, 300, 0.9, 0.05); harp([E[7], E[4], E[2], E[0]], 0.07, t + 0.1, 0.14, 0.4); },
  wish: (t) => harp([E[0], E[4], E[7]], 0.09, t, 0.18, 0.7),
  grant: (t) => { harp([E[3], E[5], E[7], E[10]], 0.05, t, 0.26, 1); choir([440, 554.4, 659.3], t, 1.6, 0.09); },
  refuse: (t) => { tone("sawtooth", 260, 230, t, 0.35, 0.09); tone("sawtooth", 220, 160, t + 0.3, 0.55, 0.09); tone("square", 110, 90, t + 0.3, 0.5, 0.05); }, // wah-wah
  lockOn: (t) => { tone("square", 1800, 1800, t, 0.03, 0.08); tone("square", 2400, 2400, t + 0.07, 0.03, 0.08); },
  smite: (t) => { noise(t, 0.08, 0.7, "highpass", 4000, 1500); noise(t + 0.03, 0.9, 0.7, "lowpass", 1600, 60); tone("sine", 100, 30, t + 0.03, 0.8, 0.55); },
  entomb: (t) => { noise(t, 0.7, 0.45, "lowpass", 400, 120, 1.2, 0.05); tone("sine", 85, 50, t + 0.5, 0.35, 0.5); },
  banish: (t) => { tone("sine", 700, 70, t, 1, 0.22, 0.05); noise(t, 1, 0.25, "bandpass", 2000, 200, 1.2, 0.05); tone("triangle", 140, 90, t + 0.5, 0.6, 0.12); },
  transform: (t) => { harp([E[7], E[9], E[10]], 0.04, t, 0.16, 0.3); meowAt(t + 0.18, 1.1); },
  purify: (t) => { for (let i = 0; i < 7; i++) tone("triangle", E[4 + (i * 3) % 7] * 2, E[4 + (i * 3) % 7] * 2, t + i * 0.09 + Math.random() * 0.04, 0.5, 0.1); noise(t, 0.9, 0.12, "bandpass", 800, 2400, 0.8, 0.2); }, // wind chimes
  shield: (t) => { choir([440, 554.4, 659.3, 880], t, 1.2, 0.08); tone("triangle", 1760, 1760, t, 0.6, 0.06, 0.2); },
  bless: (t) => { for (let i = 0; i < 6; i++) tone("triangle", 2000 + (i % 3) * 400, 1800 + (i % 3) * 400, t + i * 0.08, 0.18, 0.1); harp([E[7], E[10]], 0.12, t + 0.4, 0.2, 0.6); }, // coins
  summon: (t) => { harp([E[0], E[3], E[7], E[10]], 0.06, t, 0.18, 0.5); for (let i = 0; i < 4; i++) meowAt(t + 0.35 + i * 0.22, 0.8 + i * 0.12); },
  slowTime: (t) => { tone("sawtooth", 500, 55, t, 1.3, 0.1, 0.02); noise(t, 1.2, 0.08, "lowpass", 2000, 200); }, // tape slowing down
  reveal: (t) => { tone("sine", 300, 1300, t, 0.8, 0.14, 0.2); harp([E[7], E[10]], 0.15, t + 0.5, 0.18, 0.7); },
  sunFall: (t) => { tone("sine", 400, 1400, t, 0.85, 0.12, 0.1); noise(t + 0.85, 1.4, 1, "lowpass", 2000, 40); tone("sine", 80, 20, t + 0.85, 1.2, 0.7); },
  ascend: (t) => { for (const f of [220, 277.2, 329.6]) tone("sine", f, f * 2, t, 1.4, 0.07, 0.4); noise(t, 1.3, 0.15, "bandpass", 400, 2500, 1, 0.3); },
  reshape: (t) => { for (let i = 0; i < 5; i++) noise(t + i * 0.11, 0.1, 0.18, "bandpass", 3000 + Math.random() * 2000, 2000, 1.5); harp([E[0], E[4]], 0.15, t + 0.55, 0.15, 0.5); }, // papyrus
  boing: (t) => { tone("sine", 180, 620, t, 0.18, 0.25); tone("sine", 620, 200, t + 0.18, 0.35, 0.2); },
  ribbit: (t) => { tone("square", 260, 200, t, 0.07, 0.12); tone("square", 300, 220, t + 0.1, 0.09, 0.12); },
  camel: (t) => { tone("sawtooth", 140, 95, t, 0.5, 0.14, 0.04); noise(t, 0.45, 0.1, "lowpass", 500, 200); },
  // ---- the Pharaoh's chariot
  bossHorn: (t) => { // a brass fanfare: two detuned saws through a soft filter
    [[164.8, 0, 0.35], [246.9, 0.32, 0.3], [329.6, 0.6, 0.9]].forEach(([f, d, len]) => brass(f, t + d, len));
    tone("sine", 55, 41, t, 1.4, 0.35); noise(t, 0.4, 0.2, "lowpass", 300, 80);
  },
  bossRoar: (t) => { tone("sawtooth", 160, 70, t, 0.9, 0.2, 0.05); tone("sawtooth", 166, 72, t, 0.9, 0.16, 0.05); noise(t, 0.9, 0.35, "bandpass", 700, 200, 1.2, 0.05); },
  bossDown: (t) => { noise(t, 1.6, 0.9, "lowpass", 1500, 40); tone("sine", 70, 20, t, 1.4, 0.6); harp([E[0], E[3], E[4], E[7], E[10]], 0.1, t + 0.9, 0.24, 1); },
  hoof: (t) => { tone("triangle", 380, 220, t, 0.05, 0.16); noise(t, 0.04, 0.12, "bandpass", 1800, 900, 2); tone("triangle", 340, 200, t + 0.09, 0.05, 0.12); }, // clop-clop
  wheels: (t) => noise(t, 0.6, 0.16, "lowpass", 260, 140, 0.7, 0.1), // a low rumble
};

function brass(f: number, t: number, len: number) {
  const g = env(t, 0.13, len, 0.04);
  const lp = ctx!.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(600, t);
  lp.frequency.linearRampToValueAtTime(2200, t + 0.08);
  lp.frequency.exponentialRampToValueAtTime(700, t + len);
  lp.connect(g);
  for (const d of [-4, 4]) {
    const o = ctx!.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f + d;
    o.connect(lp);
    o.start(t);
    o.stop(t + len + 0.02);
  }
}

// ---------------------------------------------------------------- the music
// Egyptian, generated as it plays: a darbuka and riq playing real rhythms (maqsum in the desert, saidi in
// the boss fight), a breathy ney flute and an oud trading phrases in maqam Hijaz (the scale with that
// augmented second, F to G#), a drone underneath, and qanun flourishes in the council. A small scheduler
// queues each sixteenth note slightly ahead of time.

type Rhythm = { dum: number[]; tek: number[]; ka: number[]; riq: number[] };
const MOODS: Record<Mood, { bpm: number; rhythm: Rhythm | null; drive: boolean }> = {
  // maqsum: DUM tek - tek DUM - tek -
  calm: { bpm: 96, rhythm: { dum: [0, 8], tek: [2, 6, 12], ka: [14], riq: [0, 4, 8, 12] }, drive: false },
  // saidi: DUM tek - DUM DUM - tek -, faster, with fills
  boss: { bpm: 128, rhythm: { dum: [0, 6, 8], tek: [2, 12], ka: [3, 10, 14, 15], riq: [0, 2, 4, 6, 8, 10, 12, 14] }, drive: true },
  council: { bpm: 70, rhythm: null, drive: false },
};

// Hijaz on E, two octaves: E F G# A B C D | E F G# A B C D E
const H = [164.8, 174.6, 207.7, 220, 246.9, 261.6, 293.7, 329.6, 349.2, 415.3, 440, 493.9, 523.3, 587.3, 659.3];
// classic Hijaz shapes (scale degrees, -1 = rest). Most lean on the F -> G# step and fall home to E.
const MOTIFS = [
  [7, 8, 9, 8, 7, -1, 7, -1], [9, 10, 9, 8, 9, 8, 7, -1], [11, 10, 9, 10, 9, 8, 7, -1],
  [7, -1, 9, 8, 7, 6, 7, -1], [10, 11, 12, 11, 10, 9, 10, -1], [9, -1, 8, 9, 10, 9, 8, 7],
  [7, 9, 10, 11, 10, 9, 8, 7], [12, 11, 10, 9, 8, 9, 8, 7],
];
const OSTINATO = [0, -1, 0, 1, 2, -1, 1, 0]; // the oud's low riff in the boss fight (E E F G# F E)

let mood: Mood = "calm";
let moodBeforeCouncil: Mood = "calm";
let musicTimer = 0;
let nextStep = 0;
let step = 0;
let paused = false;
let phrase: number[] = [];
let lastNote = 0;

/** Ney: a breathy reed flute. Slides into each note from the last one, vibrato blooms on long notes. */
function ney(f: number, t: number, len: number, from = f, peak = 0.12) {
  const g = env(t, peak, len, 0.07);
  const o = ctx!.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.07, len * 0.3));
  const vib = ctx!.createOscillator(), amt = ctx!.createGain();
  vib.frequency.value = 5.5;
  amt.gain.setValueAtTime(0, t);
  amt.gain.linearRampToValueAtTime(f * 0.018, t + Math.min(len, 0.5)); // vibrato grows as the note holds
  vib.connect(amt).connect(o.frequency);
  const h = ctx!.createOscillator(), hg = ctx!.createGain(); // a soft upper partial
  h.type = "triangle"; h.frequency.value = f * 2; hg.gain.value = 0.12;
  o.connect(g); h.connect(hg).connect(g);
  for (const x of [o, vib, h]) { x.start(t); x.stop(t + len + 0.05); }
  noise(t, Math.min(len, 0.35), peak * 0.35, "bandpass", f * 2, f * 2, 4, 0.04); // breath
}

/** Oud: a fretless lute, plucked with a quill. A bright attack that settles, through a darkening filter. */
function oud(f: number, t: number, len = 0.5, peak = 0.13) {
  const g = env(t, peak, len, 0.003);
  const lp = ctx!.createBiquadFilter();
  lp.type = "lowpass"; lp.Q.value = 2;
  lp.frequency.setValueAtTime(3200, t);
  lp.frequency.exponentialRampToValueAtTime(500, t + len);
  lp.connect(g);
  for (const [type, mul, d] of [["sawtooth", 1, -2], ["triangle", 1, 2], ["sine", 0.5, 0]] as const) {
    const o = ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f * mul * 1.012 + d, t);
    o.frequency.exponentialRampToValueAtTime(f * mul + d, t + 0.04); // the string settles after the pluck
    o.connect(lp);
    o.start(t); o.stop(t + len + 0.02);
  }
}

/** Qanun: a run of quick plucked notes, like a zither flourish. */
function qanun(notes: number[], t: number, gap = 0.045) {
  notes.forEach((n, k) => { tone("triangle", H[n] * 2, H[n] * 2, t + k * gap, 0.6, 0.07); tone("sine", H[n] * 4, H[n] * 4, t + k * gap, 0.3, 0.02); });
}

function darbuka(kind: "dum" | "tek" | "ka", t: number) {
  if (kind === "dum") { tone("sine", 130, 58, t, 0.32, 0.34); noise(t, 0.06, 0.12, "lowpass", 900, 200); }
  else if (kind === "tek") { noise(t, 0.06, 0.16, "bandpass", 3600, 2800, 4); tone("triangle", 820, 640, t, 0.03, 0.05); }
  else noise(t, 0.04, 0.08, "bandpass", 3000, 2400, 4); // ka: the softer off-hand tap
}

function riq(t: number, accent: boolean) { // tambourine jingles
  noise(t, 0.09, accent ? 0.07 : 0.04, "bandpass", 8000, 6500, 5);
  tone("triangle", 6200, 6000, t, 0.05, accent ? 0.02 : 0.012);
}

/** Two bars of melody from two Hijaz motifs; the second answers the first and comes home to E. */
function newPhrase() {
  const a = MOTIFS[Math.floor(Math.random() * MOTIFS.length)];
  const homeward = MOTIFS.filter((m) => m[6] === 7 || m[7] === 7);
  const b = homeward[Math.floor(Math.random() * homeward.length)];
  phrase = [...a, ...b];
}

function scheduleStep(n: number, t: number) {
  const m = MOODS[mood], s16 = n % 16, beat = 60 / m.bpm;
  if (n % 32 === 0) newPhrase();
  out = musicBus;
  if (n % 32 === 0) { // the drone: E and B, renewed every two bars
    const len = beat * 8;
    tone("sine", 82.4, 82.4, t, len, mood === "council" ? 0.1 : 0.13, 0.8);
    tone("sine", 123.5, 123.5, t, len, 0.05, 0.8);
    if (mood === "council") qanun([7, 8, 9, 10, 11, 12, 14], t + beat * 2, 0.07);
  }
  const r = m.rhythm;
  if (r) {
    if (r.dum.includes(s16)) darbuka("dum", t);
    else if (r.tek.includes(s16)) darbuka("tek", t);
    else if (r.ka.includes(s16)) darbuka("ka", t);
    if (r.riq.includes(s16)) riq(t, s16 % 8 === 0);
  }
  if (m.drive && n % 2 === 0) { // the oud's low riff, in tremolo, driving the boss fight
    const d = OSTINATO[(n / 2) % 8];
    if (d >= 0) { oud(H[d] / 2, t, beat * 0.5, 0.11); oud(H[d] / 2, t + beat / 4, beat * 0.3, 0.06); }
  }
  if (n % 2 === 0) { // the melody moves in eighth notes: the ney sings, the oud answers on the second bar
    const idx = phrase[(n / 2) % 16];
    if (idx >= 0) {
      const hold = (n / 2) % 16 === 15 || phrase[((n / 2) + 1) % 16] === -1 ? beat * 0.95 : beat * 0.48;
      const answer = (n / 2) % 16 >= 8 && mood !== "boss";
      if (mood === "council") ney(H[idx], t, beat * 1.4, H[lastNote], 0.09);
      else if (answer) oud(H[idx], t, hold + 0.2, 0.12);
      else ney(H[idx] * (mood === "boss" ? 2 : 1), t, hold, H[lastNote] * (mood === "boss" ? 2 : 1));
      lastNote = idx;
    }
  }
  out = null;
}

function startMusic() {
  if (musicTimer || !ctx) return;
  nextStep = ctx.currentTime + 0.1;
  musicTimer = window.setInterval(() => {
    if (!ctx || ctx.state !== "running" || paused) return;
    while (nextStep < ctx.currentTime + 0.25) {
      scheduleStep(step, nextStep);
      nextStep += 60 / MOODS[mood].bpm / 4;
      step++;
    }
  }, 50);
}

export const audio = {
  /** volume 0..1 scales this one sound (e.g. by distance). */
  play(name: Sound, delayMs = 0, volume = 1) {
    if (!ctx || !master || !settings.sound || ctx.state !== "running" || volume <= 0) return;
    const now = performance.now();
    const gap = THROTTLE_MS[name] ?? 0;
    if (gap && now - (lastPlayed.get(name) ?? -Infinity) < gap) return;
    lastPlayed.set(name, now);
    const g = ctx.createGain();
    g.gain.value = volume;
    g.connect(master);
    out = g;
    SOUNDS[name](ctx.currentTime + 0.005 + delayMs / 1000);
    out = null;
  },
  /** The music's mood; the council remembers what to go back to. */
  setMood(next: Mood) {
    if (next === "council" && mood !== "council") moodBeforeCouncil = mood;
    if (next !== mood) { mood = next; step = Math.ceil(step / 32) * 32; } // start the new mood on a fresh phrase
  },
  /** Paused: the music fades out and stops; it picks up again on resume. */
  setPaused(on: boolean) {
    paused = on;
    if (!ctx || !musicBus) return;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(on ? 0 : musicLevel(), ctx.currentTime, on ? 0.08 : 0.25);
    if (!on) nextStep = Math.max(nextStep, ctx.currentTime + 0.05);
  },
  leaveCouncil() {
    if (mood === "council") audio.setMood(moodBeforeCouncil);
  },
  /** Apply the Settings panel's sound on/off, volume and music. */
  applySettings() {
    if (!ctx || !master || !musicBus || !mainOut) return;
    master.gain.setTargetAtTime(level(), ctx.currentTime, 0.03);
    musicBus.gain.setTargetAtTime(paused ? 0 : musicLevel(), ctx.currentTime, 0.1);
    mainOut.gain.setTargetAtTime(settings.sound ? 1 : 0, ctx.currentTime, 0.03);
  },
  toggle() {
    settings.sound = !settings.sound;
    audio.applySettings();
    return settings.sound;
  },
};
