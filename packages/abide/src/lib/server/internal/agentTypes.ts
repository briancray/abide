// AGENT TYPES (agent.md AG1/AG2) — the provider-neutral vocabulary shared by `agent()`, every
// `AgentEngine` adapter, and the RPC-as-tool surface. These are pure type declarations: the loop
// (agent.ts) and engines normalize their provider's streaming + tool-use into this taxonomy so the
// core stays provider-agnostic.

import type { JSONSchema } from "../../shared/internal/jsonSchema.ts";

// A content part of a NeutralMessage. Monomorphic discriminated union on `type` so the transcript
// stays JIT-friendly. `tool-use` is the model requesting a tool; `tool-result` carries its outcome
// (or `error` when the tool threw); `image` is a base64 payload + mime.
export type NeutralContentPart =
  | { type: "text"; text: string }
  | { type: "tool-use"; id: string; name: string; args: unknown }
  | { type: "tool-result"; id: string; result: unknown; error?: unknown }
  | { type: "image"; data: string; mime: string };

// A provider-neutral conversation message — the `messages` in-format and the accumulated
// transcript. Content is either a plain string (shorthand text) or an array of parts.
export interface NeutralMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | NeutralContentPart[];
}

// The normalized streaming event taxonomy (AG1.3). Discriminated union on `type`. Boundary frames
// (`message-start`/`message-stop`) mark one LLM turn; `done` is emitted only by the loop once a
// turn produces no tool calls — an engine emits `message-stop`, never `done`.
export type AgentFrame =
  | { type: "message-start" }
  | { type: "text-delta"; text: string }
  | { type: "thinking-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; args: unknown }
  | { type: "approval-request"; id: string; name: string; args: unknown }
  | { type: "approval-decision"; id: string; action: ApprovalDecision["action"] }
  | { type: "tool-result"; id: string; result: unknown; error?: unknown }
  | { type: "message-stop" }
  | { type: "usage"; input: number; output: number }
  | { type: "error"; error: unknown }
  | { type: "done" };

// A tool call awaiting an approval decision (AG2.5). The `id` is the tool-call id — also the
// per-run channel key `(agentRun, toolCallId)` the decision message rides back on.
export interface ApprovalRequest {
  id: string;
  name: string;
  args: unknown;
}

// The decision that flows back into a gated loop: run it, refuse it, or run it with edited args.
export type ApprovalDecision =
  | { action: "approve" }
  | { action: "deny"; reason?: string }
  | { action: "edit"; args: unknown };

// The options-driven approval policy (AG2.5). `required` decides WHICH calls are gated (omitted =
// gate every call once a policy is supplied; `boolean` = all/none; predicate = per-call). `decide`
// is the decision TRANSPORT — injectable so tests supply a fake and production wires it to the
// socket mux (`muxApprovalDecider`). No `approval` option at all → every tool auto-runs (back-compat).
export interface ApprovalPolicy {
  required?: boolean | ((call: { id: string; name: string; args: unknown }) => boolean);
  decide: (request: ApprovalRequest) => Promise<ApprovalDecision>;
}

// A single callable tool exposed to the agent (AG1.4). `run` executes in-process during the loop.
export interface AgentTool {
  name: string;
  description?: string;
  inputSchema?: JSONSchema;
  run: (args: unknown) => Promise<unknown> | unknown;
}

// The tool/capability surface offered to the agent — typically the app's RPCs as tools.
export type AgentSurface = AgentTool[];

// Per-call options carried into an engine turn (AG2.1). `tools` overrides the default surface;
// `approval` is the (deferred-transport) policy for engine tools; `signal` aborts the loop and the
// in-flight LLM call (AG2.3).
export interface AgentOptions {
  model?: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: AgentSurface;
  approval?: ApprovalPolicy;
  signal?: AbortSignal;
}

// A pluggable, provider-neutral LLM backend adapter (AG1.1). `stream` runs ONE LLM turn: it emits
// text/thinking deltas, any tool-call frames, a usage frame, then `message-stop`. The loop — not
// the engine — decides when the whole exchange is `done`.
export interface AgentEngine {
  stream(messages: NeutralMessage[], tools: AgentTool[], options: AgentOptions): AsyncIterable<AgentFrame>;
}
