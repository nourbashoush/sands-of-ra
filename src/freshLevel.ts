import type Phaser from "phaser";
import type { Checked } from "./levelFormat";

// Every new game starts from the level file as it is on disk. Changes made during a game (the gods
// reshaping the land) live in memory and end with that game. Nothing is ever written.
export async function freshLevel(registry: Phaser.Data.DataManager) {
  if (!import.meta.env.DEV) return;
  try {
    const r = (await (await fetch("/api/level")).json()) as Checked;
    if (r.ok) {
      registry.set("level", r.level);
      registry.set("levelError", null);
    }
  } catch {
    // no dev server: keep the level we have
  }
}
