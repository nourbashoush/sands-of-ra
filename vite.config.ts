import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "smol-toml";
import { defineConfig, type Plugin } from "vite";
import { oracleMiddleware } from "./server/oracle";
import { validateLevel, type Checked } from "./src/levelFormat";

// Dev-only level server. The level lives in data/levels/nile.toml and is only ever READ here:
//   GET /api/level   the validated level as JSON (422 + errors if the file is broken)
// When you edit the file (in a text editor), every open game gets a "level:changed" event with either
// the new level or the errors. Changes made during a game (the gods reshaping the land) stay in memory.
const LEVEL_FILE = resolve("data/levels/nile.toml");

function load(): Checked {
  try {
    return validateLevel(parse(readFileSync(LEVEL_FILE, "utf8")));
  } catch (e) {
    return { ok: false, errors: [`${LEVEL_FILE.split("/").slice(-3).join("/")}: ${(e as Error).message.split("\n")[0]}`] };
  }
}

function levelServer(): Plugin {
  return {
    name: "level-server",
    apply: "serve",
    configureServer(server) {
      server.watcher.add(LEVEL_FILE);
      server.watcher.on("change", (file) => {
        if (resolve(file) === LEVEL_FILE) server.ws.send({ type: "custom", event: "level:changed", data: load() });
      });
      server.middlewares.use("/api/oracle", oracleMiddleware()); // the council's agent: server/oracle.ts
      server.middlewares.use("/api/level", (req, res) => {
        const r = load();
        res.statusCode = req.method !== "GET" ? 405 : r.ok ? 200 : 422;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(req.method !== "GET" ? { ok: false, errors: ["read only"] } : r));
      });
    },
  };
}

export default defineConfig({ plugins: [levelServer()] });
