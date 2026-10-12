// Calls the agent through the dev server (server/oracle.ts runs Claude Code headless: an empty temp
// folder, no tools, no settings). The answer streams in; callers get phases and text as it is written.

export type AgentEvent =
  | { type: "phase"; phase: "summoning" | "listening" | "writing" }
  | { type: "delta"; text: string; all: string };

export type AgentResult = { ok: true; text: string; ms: number } | { ok: false; error: string; cancelled?: boolean };

export async function callAgent(prompt: string, model: string, onEvent: (e: AgentEvent) => void, signal: AbortSignal): Promise<AgentResult> {
  const started = performance.now();
  let text = "";
  try {
    const res = await fetch("/api/oracle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, model }), signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const ev = JSON.parse(buf.slice(0, i).replace(/^data: /, "")) as { type: string; phase?: string; text?: string; ms?: number; message?: string };
        buf = buf.slice(i + 2);
        if (ev.type === "phase") onEvent({ type: "phase", phase: ev.phase as "summoning" });
        else if (ev.type === "delta") { text += ev.text ?? ""; onEvent({ type: "delta", text: ev.text ?? "", all: text }); }
        else if (ev.type === "done") return { ok: true, text: ev.text ?? text, ms: ev.ms ?? performance.now() - started };
        else if (ev.type === "error") return { ok: false, error: ev.message ?? "the agent failed" };
      }
    }
    return text ? { ok: true, text, ms: performance.now() - started } : { ok: false, error: "the agent went quiet" };
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: err.name === "AbortError" ? "cancelled" : err.message, cancelled: err.name === "AbortError" };
  }
}
