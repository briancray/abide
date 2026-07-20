// claudeCodeEngine — the self-contained Claude Code `AgentEngine`. Tests drive canned `stream-json`
// through an INJECTED spawn (no real `claude` binary): they assert the NDJSON → AgentFrame
// translation, that the agent loop settles to `done` in one turn (self-contained; no tool-call
// frames → no re-execution), the argv wiring, graceful failure when the binary is missing, and abort.

import { describe, expect, test } from "bun:test";
import { claudeCodeEngine, type ClaudeChild, type ClaudeSpawn } from "./claudeCodeEngine.ts";
import { agent } from "./agent.ts";
import type { AgentFrame, NeutralMessage } from "./internal/agentTypes.ts";

async function collect(stream: AsyncIterable<AgentFrame>): Promise<AgentFrame[]> {
  const frames: AgentFrame[] = [];
  for await (const frame of stream) frames.push(frame);
  return frames;
}

function user(text: string): NeutralMessage {
  return { role: "user", content: text };
}

// A fake spawn that streams the given stream-json lines out of stdout then exits `code`. Records the
// argv, the prompt written to stdin, and whether it was killed.
interface Recorder {
  command: string[];
  stdin: string;
  killed: boolean;
}

function fakeSpawn(lines: unknown[], code = 0): { spawn: ClaudeSpawn; recorder: Recorder } {
  const recorder: Recorder = { command: [], stdin: "", killed: false };
  const spawn: ClaudeSpawn = (command) => {
    recorder.command = command;
    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const line of lines) controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        controller.close();
      },
    });
    const child: ClaudeChild = {
      stdin: {
        write(data: string): void {
          recorder.stdin += data;
        },
        end(): void {},
      },
      stdout,
      stderr: null,
      exited: Promise.resolve(code),
      kill(): void {
        recorder.killed = true;
      },
    };
    return child;
  };
  return { spawn, recorder };
}

// A spawn that never yields any stream-json and stays open until killed — for the abort test.
function hangingSpawn(): { spawn: ClaudeSpawn; recorder: Recorder } {
  const recorder: Recorder = { command: [], stdin: "", killed: false };
  const spawn: ClaudeSpawn = (command) => {
    recorder.command = command;
    let cancel: (() => void) | undefined;
    const stdout = new ReadableStream<Uint8Array>({
      cancel() {
        cancel?.();
      },
      start(controller) {
        cancel = () => {
          try {
            controller.close();
          } catch {}
        };
      },
    });
    let resolveExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    return {
      stdin: { write() {}, end() {} },
      stdout,
      stderr: null,
      exited,
      kill(): void {
        recorder.killed = true;
        cancel?.();
        resolveExit(143); // a killed process exits; realistic so the engine never blocks on `exited`
      },
    };
  };
  return { spawn, recorder };
}

describe("claudeCodeEngine — stream-json translation", () => {
  test("translates assistant text and settles the loop to done in one turn", async () => {
    const { spawn } = fakeSpawn([
      { type: "system", subtype: "init", session_id: "s1" },
      { type: "assistant", message: { content: [{ type: "text", text: "Hello, " }, { type: "text", text: "world." }] } },
      { type: "result", subtype: "success", is_error: false, result: "Hello, world.", usage: { input_tokens: 12, output_tokens: 5 } },
    ]);
    const engine = claudeCodeEngine({ spawn });
    const frames = await collect(agent(engine, [user("hi")]));

    const texts = frames.filter((f) => f.type === "text-delta").map((f) => (f as { text: string }).text);
    expect(texts).toEqual(["Hello, ", "world."]);
    expect(frames.some((f) => f.type === "usage" && f.input === 12 && f.output === 5)).toBe(true);
    // Self-contained: no tool-call frames, so the loop finishes after ONE turn with a single `done`.
    expect(frames.filter((f) => f.type === "tool-call")).toHaveLength(0);
    expect(frames.filter((f) => f.type === "done")).toHaveLength(1);
  });

  test("translates thinking deltas", async () => {
    const { spawn } = fakeSpawn([
      { type: "assistant", message: { content: [{ type: "thinking", thinking: "let me think" }, { type: "text", text: "ok" }] } },
      { type: "result", subtype: "success", usage: { input_tokens: 1, output_tokens: 1 } },
    ]);
    const frames = await collect(claudeCodeEngine({ spawn }).stream([user("q")], [], {}));
    expect(frames.some((f) => f.type === "thinking-delta" && f.text === "let me think")).toBe(true);
    expect(frames.some((f) => f.type === "text-delta" && f.text === "ok")).toBe(true);
  });

  test("surfaces Claude Code's own tool activity as informational tool-result frames (never tool-call)", async () => {
    const { spawn } = fakeSpawn([
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { path: "x" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "file body" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "done" }] } },
      { type: "result", subtype: "success", usage: { input_tokens: 3, output_tokens: 2 } },
    ]);
    const frames = await collect(agent(claudeCodeEngine({ spawn }), [user("read x")]));

    // A tool-result the engine already ran — surfaced for observability, NOT re-executed by the loop.
    expect(frames.some((f) => f.type === "tool-result" && f.id === "t1" && f.result === "file body")).toBe(true);
    expect(frames.filter((f) => f.type === "tool-call")).toHaveLength(0);
    // The loop must still terminate cleanly (exactly one done, no extra turns).
    expect(frames.filter((f) => f.type === "done")).toHaveLength(1);
  });

  test("an errored result becomes an error frame", async () => {
    const { spawn } = fakeSpawn([
      { type: "result", subtype: "error_max_turns", is_error: true, result: "hit the turn cap", usage: { input_tokens: 9, output_tokens: 0 } },
    ]);
    const frames = await collect(claudeCodeEngine({ spawn }).stream([user("go")], [], {}));
    expect(frames.some((f) => f.type === "usage")).toBe(true);
    expect(frames.some((f) => f.type === "error")).toBe(true);
    expect(frames[frames.length - 1]!.type).toBe("message-stop");
  });

  test("a tool_result with is_error surfaces the error side of tool-result", async () => {
    const { spawn } = fakeSpawn([
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t9", content: "boom", is_error: true }] } },
      { type: "result", subtype: "success", usage: {} },
    ]);
    const frames = await collect(claudeCodeEngine({ spawn }).stream([user("x")], [], {}));
    const tr = frames.find((f) => f.type === "tool-result") as { error?: unknown } | undefined;
    expect(tr).toBeDefined();
    expect(tr!.error).toBe("boom");
  });
});

describe("claudeCodeEngine — argv wiring", () => {
  test("builds print + stream-json argv, threads model/system/allowedTools, and writes the prompt to stdin", async () => {
    const { spawn, recorder } = fakeSpawn([{ type: "result", subtype: "success", usage: {} }]);
    const engine = claudeCodeEngine({ spawn, model: "claude-opus-4-8", allowedTools: ["Read"] });
    await collect(engine.stream([{ role: "system", content: "be terse" }, user("hello")], [], { system: "extra sys" }));

    expect(recorder.command.slice(0, 5)).toEqual(["claude", "--print", "--output-format", "stream-json", "--verbose"]);
    expect(recorder.command).toContain("--model");
    expect(recorder.command).toContain("claude-opus-4-8");
    expect(recorder.command).toContain("--append-system-prompt");
    // options.system + the system-role message are combined.
    expect(recorder.command.some((a) => a.includes("extra sys") && a.includes("be terse"))).toBe(true);
    expect(recorder.command).toContain("--allowedTools");
    expect(recorder.command).toContain("Read");
    // A lone user message is passed verbatim as the prompt.
    expect(recorder.stdin).toBe("hello");
  });

  test("per-call options.model overrides the engine default", async () => {
    const { spawn, recorder } = fakeSpawn([{ type: "result", subtype: "success", usage: {} }]);
    await collect(claudeCodeEngine({ spawn, model: "engine-default" }).stream([user("x")], [], { model: "per-call" }));
    expect(recorder.command).toContain("per-call");
    expect(recorder.command).not.toContain("engine-default");
  });
});

describe("claudeCodeEngine — robustness", () => {
  test("a missing binary yields a clear error frame, not a crash", async () => {
    const spawn: ClaudeSpawn = () => {
      throw new Error("ENOENT: no such file or directory, posix_spawn 'claude'");
    };
    const frames = await collect(agent(claudeCodeEngine({ spawn, path: "claude" }), [user("hi")]));
    const err = frames.find((f) => f.type === "error") as { error: unknown } | undefined;
    expect(err).toBeDefined();
    expect(String((err!.error as Error).message)).toContain("Claude Code installed");
    // The loop still terminates.
    expect(frames.filter((f) => f.type === "done")).toHaveLength(1);
  });

  test("aborting kills the child process", async () => {
    const { spawn, recorder } = hangingSpawn();
    const controller = new AbortController();
    const frames: AgentFrame[] = [];
    const run = (async () => {
      for await (const frame of claudeCodeEngine({ spawn }).stream([user("hi")], [], { signal: controller.signal })) {
        frames.push(frame);
      }
    })();
    // Let the engine spawn + start reading, then abort.
    await Promise.resolve();
    controller.abort();
    await run;
    expect(recorder.killed).toBe(true);
  });

  test("the default engine (no spawn injected) exposes a stream function", () => {
    // Constructing the real engine must not throw (the old stub threw on construction).
    const engine = claudeCodeEngine();
    expect(typeof engine.stream).toBe("function");
  });
});
