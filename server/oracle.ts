import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

// The oracle's back end (dev only, mounted by vite.config.ts). The browser builds the prompt and
// checks the answer; this only runs Claude Code headless and streams what it writes.
//
//   POST /api/oracle        { prompt, model } -> a stream of "data: {json}\n\n" events:
//                           phase, delta (text as it is written), done (full text, ms), error
//                           AGENT_MESSAGE lines also to data/agent-messages.md
//
// Least privilege: an empty temporary folder, no tools, no settings, no saved session.
// All the agent can do is answer with text. Nothing is logged or saved: each run is fresh.

const TIMEOUT_MS = 150_000;
const MODELS = new Set(["sonnet", "opus", "haiku"]);

function findClaude() {
  const local = join(homedir(), ".local", "bin", "claude");
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir && existsSync(join(dir, "claude"))) return join(dir, "claude");
  }
  return existsSync(local) ? local : null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => ok(body));
    req.on("error", fail);
  });
}

export function oracleMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== "POST") return next();
    if (req.url !== "/" && req.url !== "") return next();

    let input: { prompt?: string; model?: string };
    try {
      input = JSON.parse(await readBody(req));
    } catch {
      res.statusCode = 400;
      return res.end("bad request");
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    const claude = findClaude();
    if (!claude) {
      send({ type: "error", message: "Claude Code is not installed (no `claude` on PATH or in ~/.local/bin). Install it from claude.ai/code, run `claude` once to log in, then try again." });
      return res.end();
    }
    const model = MODELS.has(input.model ?? "") ? input.model! : "sonnet";
    const dir = mkdtempSync(join(tmpdir(), "oracle-"));
    const started = Date.now();
    let child: ChildProcess | null = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (child && child.exitCode === null) child.kill("SIGTERM");
      rmSync(dir, { recursive: true, force: true });
      res.end();
    };
    const timer = setTimeout(() => {
      send({ type: "error", message: `The oracle took longer than ${TIMEOUT_MS / 1000} s and was stopped.` });
      finish();
    }, TIMEOUT_MS);
    res.on("close", finish); // the browser cancelled or went away: kill the agent

    send({ type: "phase", phase: "summoning", model });
    child = spawn(claude, [
      "-p", "--tools", "", "--no-session-persistence", "--setting-sources", "", "--disable-slash-commands",
      "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", model,
    ], { cwd: dir, env: { ...process.env, PATH: `${join(homedir(), ".local", "bin")}:${process.env.PATH ?? ""}` }, stdio: ["pipe", "pipe", "pipe"] });

    let buffer = "", text = "", stderr = "", wrote = false;
    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let ev: any;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "system" && ev.subtype === "init") send({ type: "phase", phase: "listening" });
        else if (ev.type === "stream_event" && ev.event?.type === "content_block_delta" && ev.event.delta?.type === "text_delta") {
          if (!wrote) { wrote = true; send({ type: "phase", phase: "writing", firstTokenMs: Date.now() - started }); }
          text += ev.event.delta.text;
          send({ type: "delta", text: ev.event.delta.text });
        } else if (ev.type === "result") {
          const full = typeof ev.result === "string" && ev.result ? ev.result : text;
          if (ev.is_error) send({ type: "error", message: full || "the oracle failed" });
          else send({ type: "done", text: full, ms: Date.now() - started, model });
          finish();
        }
      }
    });
    child.stderr!.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (e) => { send({ type: "error", message: `could not start claude: ${e.message}` }); finish(); });
    child.on("close", (code) => {
      if (finished) return;
      if (text) send({ type: "done", text, ms: Date.now() - started, model });
      else send({ type: "error", message: (stderr.trim().split("\n").pop() || `claude exited with code ${code}`) + (/log ?in|auth/i.test(stderr) ? " (run `claude` once in a terminal to log in)" : "") });
      finish();
    });
    child.stdin!.end(input.prompt ?? "");
  };
}
