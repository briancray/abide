// claudeCodeEngine — a Claude Code `AgentEngine` (agent.md AG1) that drives the local `claude` CLI.
//
// Unlike `claudeEngine` (a single-turn adapter over the Anthropic Messages API, where abide's loop
// executes tools), Claude Code runs its OWN agentic loop and executes its OWN tools. So this is a
// SELF-CONTAINED engine: one `stream()` call spawns `claude --print --output-format stream-json`,
// translates its newline-delimited JSON into abide's `AgentFrame` taxonomy, and emits NO `tool-call`
// frames — Claude Code already ran any tools internally. The loop (agent.ts) therefore sees a turn
// with zero outstanding tool calls and settles to `done`. Claude Code's own tool activity is surfaced
// as informational `tool-result` frames (never `tool-call`), so the loop never double-executes.
//
// bun + native only: spawn is `Bun.spawn` (no npm dep). The `claude` binary is an OPTIONAL RUNTIME
// dependency — if it isn't installed, `stream()` yields a single `error` frame naming the fix rather
// than crashing. `spawn` is injectable so tests drive canned stream-json hermetically (no real CLI).
//
// AG2.5 — engine (non-app) tools are OFF by default: this engine passes no tool grants and runs in a
// permission mode that never prompts, so Claude Code's built-in tools (bash/edit/…) don't run unless
// the caller explicitly opts in via `allowedTools`. DEFERRED (documented, not built): exposing the
// app's own RPCs as tools to the spawned Claude Code via abide's MCP face (`--mcp-config` at the app
// URL + auth token) and reconciling Claude Code's permission model with abide's `ApprovalPolicy`.

import type {
  AgentEngine,
  AgentFrame,
  AgentOptions,
  AgentTool,
  NeutralContentPart,
  NeutralMessage,
} from "./internal/agentTypes.ts";

// The subset of a spawned child process this engine depends on — a `Bun.spawn` result satisfies it.
// Injectable (via `spawn`) so tests supply a fake child streaming canned stream-json.
export interface ClaudeChild {
  stdin: { write(data: string): void; end(): void } | null;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill(): void;
}

export type ClaudeSpawn = (
  command: string[],
  options: { stdin: "pipe"; stdout: "pipe"; stderr: "pipe"; cwd?: string },
) => ClaudeChild;

export interface ClaudeCodeEngineOptions {
  // Model passed to `--model` (else Claude Code's default). `AgentOptions.model` overrides per call.
  model?: string;
  // The CLI to spawn (default `"claude"`; set an absolute path when it isn't on PATH).
  path?: string;
  // Working directory for the spawned process (default: the current dir).
  cwd?: string;
  // Injectable spawn (default `Bun.spawn`) — the test seam.
  spawn?: ClaudeSpawn;
  // Explicit opt-in to Claude Code's built-in tools (default: none → tools effectively off, AG2.5).
  allowedTools?: string[];
  disallowedTools?: string[];
  // Extra raw CLI args appended last (escape hatch; e.g. `--mcp-config` for the deferred MCP path).
  extraArgs?: string[];
}

const RESULT_TYPE = "result";

export function claudeCodeEngine(opts: ClaudeCodeEngineOptions = {}): AgentEngine {
  return {
    stream(messages: NeutralMessage[], tools: AgentTool[], options: AgentOptions): AsyncIterable<AgentFrame> {
      return streamTurn(opts, messages, tools, options);
    },
  };
}

// Default child factory over `Bun.spawn`, adapted to `ClaudeChild`. Kept behind the `spawn` option so
// the async generator never references `Bun` directly (tests inject a fake and never touch the CLI).
function defaultSpawn(command: string[], options: { stdin: "pipe"; stdout: "pipe"; stderr: "pipe"; cwd?: string }): ClaudeChild {
  const proc = Bun.spawn(command, options);
  return {
    stdin: proc.stdin as unknown as { write(data: string): void; end(): void },
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    stderr: proc.stderr as ReadableStream<Uint8Array>,
    exited: proc.exited,
    kill: () => proc.kill(),
  };
}

async function* streamTurn(
  opts: ClaudeCodeEngineOptions,
  messages: NeutralMessage[],
  tools: AgentTool[],
  options: AgentOptions,
): AsyncIterable<AgentFrame> {
  void tools; // app tools are NOT handed to Claude Code in v1 (self-contained; MCP path deferred).
  const spawn = opts.spawn ?? defaultSpawn;
  const { system, prompt } = renderPrompt(messages, options.system);
  const command = buildCommand(opts, options, system);

  let child: ClaudeChild;
  try {
    child = spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "pipe", ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}) });
  } catch (caught) {
    // ENOENT etc. — the binary isn't installed / not on PATH. Fail loud but recoverable.
    yield { type: "error", error: new Error(`claudeCodeEngine: could not spawn "${opts.path ?? "claude"}" — is Claude Code installed? (${errorText(caught)})`) };
    yield { type: "message-stop" };
    return;
  }

  // Abort (AG2.3): killing the child ends the stdout stream, unwinding the loop below.
  const signal = options.signal;
  const onAbort = (): void => child.kill();
  if (signal !== undefined) {
    if (signal.aborted) child.kill();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    child.stdin?.write(prompt);
    child.stdin?.end();
  } catch {
    // A broken pipe (child died immediately) surfaces via the exit handling below.
  }

  yield { type: "message-start" };

  // Pair each Claude-Code tool_use id → name so its later tool_result is a legible `tool-result`.
  const toolNames = new Map<string, string>();
  let sawResult = false;
  let emittedError = false;

  try {
    for await (const line of ndjsonLines(child.stdout)) {
      for (const frame of translate(line, toolNames)) {
        if (frame.type === "error") emittedError = true;
        if (frame.type === "usage") sawResult = true;
        yield frame;
      }
    }

    // On abort the child was killed and `exited` may lag; skip the exit-code check rather than block.
    if (signal?.aborted !== true) {
      const code = await child.exited;
      if (!sawResult && !emittedError && code !== 0) {
        yield { type: "error", error: new Error(`claudeCodeEngine: claude exited ${code} without a result`) };
      }
    }
  } finally {
    if (signal !== undefined) signal.removeEventListener("abort", onAbort);
  }

  yield { type: "message-stop" };
}

// Translate one decoded stream-json line into zero or more neutral frames. Unknown line types and
// unrepresentable shapes are ignored (defensive: the CLI protocol evolves and adds line types).
function translate(line: StreamJsonLine, toolNames: Map<string, string>): AgentFrame[] {
  const out: AgentFrame[] = [];
  switch (line.type) {
    case "assistant": {
      const content = line.message?.content;
      if (typeof content === "string") {
        if (content !== "") out.push({ type: "text-delta", text: content });
        break;
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string") {
            out.push({ type: "text-delta", text: block.text });
          } else if (block.type === "thinking" && typeof block.thinking === "string") {
            out.push({ type: "thinking-delta", text: block.thinking });
          } else if (block.type === "tool_use" && typeof block.id === "string") {
            // Claude Code will EXECUTE this itself — remember it so the paired tool_result reads well.
            toolNames.set(block.id, typeof block.name === "string" ? block.name : "");
          }
        }
      }
      break;
    }
    case "user": {
      // Claude Code's own tool executions come back as user `tool_result` blocks. Surface them as
      // informational `tool-result` frames (NEVER `tool-call`, which the loop would try to execute).
      const content = line.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
            const frame: AgentFrame =
              block.is_error === true
                ? { type: "tool-result", id: block.tool_use_id, result: undefined, error: block.content }
                : { type: "tool-result", id: block.tool_use_id, result: block.content };
            out.push(frame);
          }
        }
      }
      break;
    }
    case RESULT_TYPE: {
      const usage = line.usage;
      out.push({ type: "usage", input: usage?.input_tokens ?? 0, output: usage?.output_tokens ?? 0 });
      if (line.is_error === true || (line.subtype !== undefined && line.subtype !== "success")) {
        out.push({ type: "error", error: new Error(`claude result ${line.subtype ?? "error"}: ${stringify(line.result)}`) });
      }
      break;
    }
  }
  return out;
}

// Build the `claude` argv. Print mode + stream-json is the only machine-readable surface; `--verbose`
// is required alongside it to emit per-message lines rather than a single summary.
function buildCommand(opts: ClaudeCodeEngineOptions, options: AgentOptions, system: string | undefined): string[] {
  const command = [opts.path ?? "claude", "--print", "--output-format", "stream-json", "--verbose"];
  const model = options.model ?? opts.model;
  if (model !== undefined) command.push("--model", model);
  if (system !== undefined && system !== "") command.push("--append-system-prompt", system);
  if (opts.allowedTools !== undefined && opts.allowedTools.length > 0) command.push("--allowedTools", ...opts.allowedTools);
  if (opts.disallowedTools !== undefined && opts.disallowedTools.length > 0) command.push("--disallowedTools", ...opts.disallowedTools);
  if (opts.extraArgs !== undefined) command.push(...opts.extraArgs);
  return command;
}

// Flatten the neutral transcript into a single stdin prompt + a combined system string. System-role
// messages (and `options.system`) become the system prompt; the rest render as the prompt text (a
// lone user message is passed verbatim; a longer history is role-labeled for context).
function renderPrompt(messages: NeutralMessage[], optionsSystem: string | undefined): { system: string | undefined; prompt: string } {
  const systemParts: string[] = [];
  if (optionsSystem !== undefined) systemParts.push(optionsSystem);
  const conversation: NeutralMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") systemParts.push(collectText(message.content));
    else conversation.push(message);
  }

  let prompt: string;
  if (conversation.length === 1 && conversation[0]!.role === "user") {
    prompt = collectText(conversation[0]!.content);
  } else {
    prompt = conversation.map((message) => `[${message.role}] ${collectText(message.content)}`).join("\n\n");
  }

  return { system: systemParts.length > 0 ? systemParts.join("\n") : undefined, prompt };
}

function collectText(content: string | NeutralContentPart[]): string {
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const part of content) {
    if (part.type === "text") parts.push(part.text);
  }
  return parts.join("\n");
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

// One decoded stream-json line. Only the fields this engine reads are typed; the CLI emits more.
interface StreamJsonLine {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  message?: { content?: string | StreamJsonBlock[] };
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface StreamJsonBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

// Newline-delimited JSON reader over the child's stdout. Yields each parsed line object; malformed
// lines are skipped rather than aborting the turn (matches the SSE parser in claudeEngine).
async function* ndjsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamJsonLine> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line.trim() === "") continue;
      const parsed = tryParse(line);
      if (parsed !== undefined) yield parsed;
    }
  }

  const tail = buffer.trim();
  if (tail !== "") {
    const parsed = tryParse(tail);
    if (parsed !== undefined) yield parsed;
  }
}

function tryParse(line: string): StreamJsonLine | undefined {
  try {
    const value = JSON.parse(line) as StreamJsonLine;
    return typeof value === "object" && value !== null && typeof value.type === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}
