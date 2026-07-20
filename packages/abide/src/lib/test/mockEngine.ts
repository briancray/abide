// mockEngine — a deterministic `AgentEngine` for driving the agent loop in tests. `script` is an
// array of per-turn plans; each plan is the exact list of frames that turn emits (text/thinking
// deltas, tool-call frames, a usage frame, …). The mock advances one plan per turn (per `stream`
// call). A plan need not include `message-stop` — the mock always appends one, since that is the
// engine's turn boundary. Once the script is exhausted every further turn emits an empty turn
// (message-stop only, no tool calls), which lets the loop settle to `done`.
//
// `turns` records the transcript the loop passed into each turn, so a test can assert the loop
// appended tool-use / tool-result messages before the next turn.

import type { AgentEngine, AgentFrame, AgentOptions, AgentTool, NeutralMessage } from "../server/internal/agentTypes.ts";

export interface MockEngine extends AgentEngine {
  turns: NeutralMessage[][];
}

export function mockEngine(script: AgentFrame[][]): MockEngine {
  let turn = 0;
  const turns: NeutralMessage[][] = [];

  const engine: MockEngine = {
    turns,
    async *stream(messages: NeutralMessage[], _tools: AgentTool[], _options: AgentOptions): AsyncIterable<AgentFrame> {
      // Snapshot the transcript the loop handed us for this turn.
      turns.push(messages.slice());
      const plan = script[turn];
      turn++;
      if (plan !== undefined) {
        for (const frame of plan) {
          if (frame.type === "message-stop") continue; // the mock owns the boundary
          yield frame;
        }
      }
      yield { type: "message-stop" };
    },
  };
  return engine;
}
