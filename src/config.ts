import Phaser from "phaser";
// Game constants, hard-coded (workshop exercise 1 starting point).

export const TILE = 64;
export const VIEW_W = 1024; // 16 columns
// The world is 16 columns wide and always fills the window's width; the visible height follows
// the window's shape (read once at load), between 7.5 and 16 rows.
export const VIEW_H = typeof window === "undefined"
  ? 768
  : Math.round(Phaser.Math.Clamp((VIEW_W * window.innerHeight) / window.innerWidth, 480, 1024));
// Render resolution: the canvas has RES device pixels per game pixel (cameras zoom by RES),
// so the game is drawn sharp on large and high-DPI screens instead of being stretched up.
export const RES = typeof window === "undefined"
  ? 1
  : Phaser.Math.Clamp(Math.ceil(((window.innerWidth * window.devicePixelRatio) / VIEW_W) * 4) / 4, 1, 3);
// The game's name (the level has its own, from the level file: "Crossing the Nile").
export const GAME_TITLE = "Sands of Ra";

// No border around the play area: the HUD floats over the game (kept as a constant so layouts can inset).
export const FRAME = { top: 0, bottom: 0, side: 0 };
// The floating stat pills along the top: their y and height, in pixels.
export const STAT_BAR = { y: 10, h: 32 };
// Stat cartouches in the top band: [x, width].
// Natural cat coats (ginger, sand, cream, grey tabby, smoke, near-black), tinted onto the pale cat sprite.
export const CAT_COATS = [0xe0903a, 0xd8b078, 0xf2e6cc, 0x9a9a92, 0x6a625a, 0x3a3430];

// Five equal cartouches spread evenly across the top band: [x, width].
const CART_MARGIN = 34, CART_GAP = 22;
const CART_W = (VIEW_W - 2 * CART_MARGIN - 4 * CART_GAP) / 5;
const cart = (i: number) => [CART_MARGIN + i * (CART_W + CART_GAP), CART_W] as const;
export const CARTOUCHES = { score: cart(0), lives: cart(1), storms: cart(2), pows: cart(3), cats: cart(4) };

// Frame indices in public/assets/tiles.png (Kenney tilesheet, 27 columns, tile_N = N - 1).
export const TILE_FRAMES = {
  grass: [0, 1, 2, 3],
  road: [4, 5],
  water: [18, 19],
  bridge: [43],
  wall: [352],
  bunkerBase: [356],
  crate: [128],
  groundDecals: [182, 212, 236, 237, 238, 239],
};

export const PLAYER = {
  speed: 190,
  fireInterval: 110,
  bulletSpeed: 620,
  bulletSpread: 0.06,
  bulletRange: 520,
  startGrenades: 3,
  grenadeRange: 330,
  lives: 3,
  invulnerableMs: 2000,
};

// The player's grenade is a sandstorm bomb: a whirling cloud that blinds (no shooting),
// slows and wears down every enemy inside it, armoured ones included.
export const SANDSTORM = {
  radius: 130,
  durationMs: 4000,
  tickMs: 700,
  damage: 1,
  slow: 0.35, // enemy speed multiplier inside the cloud
};

export const GRENADE = {
  flightMs: 700,
  radius: 100,
  damage: 3,
};

export const ENEMIES = {
  s1: { name: "rifleman", hp: 1, speed: 70, stopDistance: 4 * TILE, range: 8 * TILE, fireInterval: 2000, bulletSpeed: 280, score: 100 },
  s2: { name: "grenadier", hp: 2, speed: 55, minDistance: 5 * TILE, maxDistance: 7 * TILE, fireInterval: 3500, score: 200 },
  t1: { name: "tank", hp: 8, speed: 38, stopDistance: 3 * TILE, range: 10 * TILE, fireInterval: 4000, bulletSpeed: 200, score: 1000 },
  k1: { name: "Pharaoh", hp: 40, speed: 150, rageSpeed: 250, minX: 2 * TILE, maxX: 14 * TILE, fireInterval: 1400, rageFireInterval: 900, potInterval: 2600, bulletSpeed: 300, range: 12 * TILE, score: 5000 },
  b1: { name: "bunker", hp: 6, range: 9 * TILE, arcDeg: 90, fireInterval: 1000, bulletSpeed: 300, score: 500 },
} as const;

export const POW_SCORE = 1000;
// Cats: friendly. They pad over when you're near; touch one and it joins your cat army,
// trotting along behind you in a crowd.
export const CATS = {
  extra: 110, // scattered at random on top of the c1 cats in the level
  score: 250,
  lureDistance: 240, // wild cats within this range come to you
  lureSpeed: 150,
  catchDistance: 44,
  followGap: 4, // trail samples between one army cat and the next
  followSpread: 22, // how wide the army fans out behind you
  // the army fights: cats pounce on enemies you can see, and come back when they're out of view
  attackRange: 420, // from the player
  attackSpeed: 290,
  biteDamage: 0.35,
  biteMs: 800,
};

// The pharaoh's ankh bolts weave gently as they fly. The bigger the cat army, the harder they hit
// (and the bigger and brighter they look); the weave only grows a little.
export const ANKH = {
  amplitude: 3, // px, with no cats
  amplitudePerCat: 0.25,
  maxAmplitude: 10,
  wavelength: 140, // px
  power: 1, // damage per bolt with no cats
  powerPerCat: 0.06,
  maxPower: 3,
};
export const GRENADE_PICKUP = 3;
export const BARREL = { hp: 2, radius: 120, damage: 4 };
export const CRATE_HP = 3;
