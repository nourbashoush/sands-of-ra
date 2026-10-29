// Player settings (the pause menu's Settings panel). In memory only: they last for this session
// and every page load starts from the defaults. Nothing is saved.

export type Difficulty = "easy" | "normal" | "hard";

export const settings = {
  difficulty: "normal" as Difficulty,
  /** The Among Us style darkness behind walls. Off: you see the whole screen. */
  lineOfSight: true,
  screenShake: true,
  /** Pause when the window loses focus. */
  pauseOnBlur: true,
  sound: true,
  volume: "medium" as "low" | "medium" | "high",
  music: "medium" as "off" | "low" | "medium" | "high",
  /** Who answers wishes: the small built-in model (src/council/local.ts), or Claude. Claude can only
   *  be picked when running locally with Claude Code installed (see claudeAvailable in council/agent.ts). */
  wishes: "model" as "claude" | "model",
};

const DIFFICULTY: Record<Difficulty, { lives: number; fireEvery: number }> = {
  easy: { lives: 5, fireEvery: 1.6 }, // enemies shoot 1.6x less often
  normal: { lives: 3, fireEvery: 1 },
  hard: { lives: 2, fireEvery: 0.7 },
};

export const difficulty = () => DIFFICULTY[settings.difficulty];
