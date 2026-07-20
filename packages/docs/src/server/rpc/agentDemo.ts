import { type AgentEngine, type AgentFrame, type AgentTool, agent } from "abide/server/agent"
import { GET } from "abide/server/GET"
import { jsonl } from "abide/server/jsonl"

// A DETERMINISTIC scripted `AgentEngine` (no real LLM) so the provider-neutral `agent()` loop + the
// `AgentFrame` stream can be dogfooded in a real browser e2e without an API key. The Claude / Claude
// Code engines plug into this exact seam; here a scripted engine drives it reproducibly.
//
// Turn 0 requests the `clock` tool; the loop executes it in-process (AGENT tool surface) and feeds the
// result back; turn 1 answers, then the loop emits `done`. A fresh engine per request → fresh turn 0.
function scriptedEngine(): AgentEngine {
  let turn = 0
  return {
    async *stream(): AsyncIterable<AgentFrame> {
      const step = turn++
      yield { type: "message-start" }
      if (step === 0) {
        yield { type: "text-delta", text: "Let me check the clock… " }
        yield { type: "tool-call", id: "call-1", name: "clock", args: {} }
      } else {
        yield { type: "text-delta", text: "The tool ran and the loop closed." }
        yield { type: "usage", input: 12, output: 8 }
      }
      yield { type: "message-stop" }
    },
  }
}

// A streaming read: `agent(...)` yields `AgentFrame`s; we map each to a small display shape and stream
// it as `application/jsonl`, which the page consumes with `{#for await}`. The mapping keeps the page
// template simple (every item has `{ kind, text }` — no union narrowing needed in the markup).
export default GET(() => {
  const clock: AgentTool = { name: "clock", run: () => ({ iso: "2026-01-01T00:00:00.000Z" }) }

  async function* run(): AsyncIterable<{ kind: string; text: string }> {
    const frames = agent(scriptedEngine(), [{ role: "user", content: "What time is it?" }], {
      tools: [clock],
    })
    for await (const frame of frames) {
      if (frame.type === "text-delta") yield { kind: "text", text: frame.text }
      else if (frame.type === "tool-call") yield { kind: "tool-call", text: `${frame.name}()` }
      else if (frame.type === "tool-result")
        yield { kind: "tool-result", text: JSON.stringify(frame.result) }
      else if (frame.type === "done") yield { kind: "done", text: "✓ complete" }
    }
  }

  return jsonl(run())
})
