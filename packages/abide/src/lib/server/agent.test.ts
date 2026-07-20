import { describe, expect, test } from "bun:test";
import { agent } from "./agent.ts";
import { GET } from "./GET.ts";
import { rpcTools } from "./internal/rpcTools.ts";
import { mockEngine } from "../test/mockEngine.ts";
import type { AgentFrame, AgentTool, NeutralMessage } from "./internal/agentTypes.ts";

async function collect(stream: AsyncIterable<AgentFrame>): Promise<AgentFrame[]> {
  const frames: AgentFrame[] = [];
  for await (const frame of stream) frames.push(frame);
  return frames;
}

function user(text: string): NeutralMessage {
  return { role: "user", content: text };
}

describe("agent loop", () => {
  test("single turn with no tools yields text frames then done", async () => {
    const engine = mockEngine([
      [
        { type: "text-delta", text: "hello " },
        { type: "text-delta", text: "world" },
      ],
    ]);

    const frames = await collect(agent(engine, [user("hi")]));

    expect(frames).toEqual([
      { type: "text-delta", text: "hello " },
      { type: "text-delta", text: "world" },
      { type: "done" },
    ]);
  });

  test("tool-call runs the tool, appends result to transcript, then continues", async () => {
    let ran: { a: number; b: number } | undefined;
    const add: AgentTool = {
      name: "add",
      run: (args: unknown): number => {
        const typed = args as { a: number; b: number };
        ran = typed;
        return typed.a + typed.b;
      },
    };

    const engine = mockEngine([
      [{ type: "tool-call", id: "c1", name: "add", args: { a: 1, b: 2 } }],
      [{ type: "text-delta", text: "the answer is 3" }],
    ]);

    const frames = await collect(agent(engine, [user("add 1 and 2")], { tools: [add] }));

    expect(frames).toEqual([
      { type: "tool-call", id: "c1", name: "add", args: { a: 1, b: 2 } },
      { type: "tool-result", id: "c1", result: 3 },
      { type: "text-delta", text: "the answer is 3" },
      { type: "done" },
    ]);

    // The tool actually ran with the model's args.
    expect(ran).toEqual({ a: 1, b: 2 });

    // The transcript handed to turn 2 grew: original user msg + assistant tool-use + tool result.
    const secondTurn = engine.turns[1]!;
    expect(secondTurn).toHaveLength(3);
    expect(secondTurn[1]).toEqual({
      role: "assistant",
      content: [{ type: "tool-use", id: "c1", name: "add", args: { a: 1, b: 2 } }],
    });
    expect(secondTurn[2]).toEqual({
      role: "tool",
      content: [{ type: "tool-result", id: "c1", result: 3 }],
    });
  });

  test("a throwing tool surfaces an error tool-result and the loop continues", async () => {
    const boom: AgentTool = {
      name: "boom",
      run: (): never => {
        throw new Error("kaboom");
      },
    };

    const engine = mockEngine([
      [{ type: "tool-call", id: "c1", name: "boom", args: {} }],
      [{ type: "text-delta", text: "recovered" }],
    ]);

    const frames = await collect(agent(engine, [user("go")], { tools: [boom] }));

    const toolResult = frames.find((f) => f.type === "tool-result");
    expect(toolResult).toBeDefined();
    expect((toolResult as { error?: unknown }).error).toBeInstanceOf(Error);
    expect(((toolResult as { error?: Error }).error as Error).message).toBe("kaboom");

    // Loop continued to the next turn and finished.
    expect(frames.some((f) => f.type === "text-delta")).toBe(true);
    expect(frames[frames.length - 1]).toEqual({ type: "done" });

    // The error was also threaded into the transcript for the follow-up turn.
    const followUp = engine.turns[1]!;
    const toolMessage = followUp[followUp.length - 1]!;
    expect(toolMessage.role).toBe("tool");
  });

  test("abort via signal stops the loop", async () => {
    const controller = new AbortController();

    const stop: AgentTool = {
      name: "stop",
      run: (): string => {
        controller.abort();
        return "stopping";
      },
    };

    // Every turn asks for the tool again — without the abort the loop would never terminate.
    const engine = mockEngine([
      [{ type: "tool-call", id: "c1", name: "stop", args: {} }],
      [{ type: "tool-call", id: "c2", name: "stop", args: {} }],
      [{ type: "tool-call", id: "c3", name: "stop", args: {} }],
    ]);

    const frames = await collect(agent(engine, [user("loop")], { tools: [stop], signal: controller.signal }));

    // Aborting returns without a `done` frame and never drives a second engine turn.
    expect(frames.some((f) => f.type === "done")).toBe(false);
    expect(engine.turns).toHaveLength(1);
  });
});

describe("rpcTools", () => {
  test("maps an Rpc to a tool whose run invokes the handler", async () => {
    const add = GET((args: { a: number; b: number }) => args.a + args.b);

    const surface = rpcTools({ add });
    expect(surface).toHaveLength(1);

    const tool = surface[0]!;
    expect(tool.name).toBe("add");

    const result = await tool.run({ a: 2, b: 5 });
    expect(result).toBe(7);
  });
});
