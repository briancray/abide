import { describe, expect, test } from "bun:test";
import { agent } from "./agent.ts";
import { mockEngine } from "../test/mockEngine.ts";
import {
  agentApprovalChannelName,
  agentApprovalHub,
  muxApprovalDecider,
  publishApprovalDecision,
} from "./internal/agentApproval.ts";
import type { ApprovalChannelFrame } from "./internal/agentApproval.ts";
import type {
  AgentFrame,
  ApprovalDecision,
  ApprovalPolicy,
  AgentTool,
  NeutralMessage,
} from "./internal/agentTypes.ts";

async function collect(stream: AsyncIterable<AgentFrame>): Promise<AgentFrame[]> {
  const frames: AgentFrame[] = [];
  for await (const frame of stream) frames.push(frame);
  return frames;
}

function user(text: string): NeutralMessage {
  return { role: "user", content: text };
}

function makeTool(sink: { ran: boolean; args: unknown }): AgentTool {
  return {
    name: "act",
    run: (args: unknown): string => {
      sink.ran = true;
      sink.args = args;
      return "done";
    },
  };
}

describe("agent approval gate", () => {
  test("approve → tool runs and the result lands in the transcript", async () => {
    const sink = { ran: false, args: undefined as unknown };
    const tool = makeTool(sink);
    const engine = mockEngine([
      [{ type: "tool-call", id: "c1", name: "act", args: { x: 1 } }],
      [{ type: "text-delta", text: "ok" }],
    ]);
    const approval: ApprovalPolicy = {
      required: true,
      decide: async (): Promise<ApprovalDecision> => ({ action: "approve" }),
    };

    const frames = await collect(agent(engine, [user("go")], { tools: [tool], approval }));

    expect(frames).toContainEqual({ type: "approval-request", id: "c1", name: "act", args: { x: 1 } });
    expect(frames).toContainEqual({ type: "approval-decision", id: "c1", action: "approve" });
    expect(sink.ran).toBe(true);
    expect(sink.args).toEqual({ x: 1 });

    const secondTurn = engine.turns[1]!;
    expect(secondTurn[secondTurn.length - 1]).toEqual({
      role: "tool",
      content: [{ type: "tool-result", id: "c1", result: "done" }],
    });
  });

  test("deny → tool does NOT run, transcript carries a denied tool-result the model sees", async () => {
    const sink = { ran: false, args: undefined as unknown };
    const tool = makeTool(sink);
    const engine = mockEngine([
      [{ type: "tool-call", id: "c1", name: "act", args: { x: 1 } }],
      [{ type: "text-delta", text: "understood" }],
    ]);
    const approval: ApprovalPolicy = {
      required: true,
      decide: async (): Promise<ApprovalDecision> => ({ action: "deny", reason: "not allowed" }),
    };

    const frames = await collect(agent(engine, [user("go")], { tools: [tool], approval }));

    expect(frames).toContainEqual({ type: "approval-decision", id: "c1", action: "deny" });
    expect(sink.ran).toBe(false);

    const toolResult = frames.find((f) => f.type === "tool-result") as { error?: unknown } | undefined;
    expect(toolResult).toBeDefined();
    expect(toolResult!.error).toBeInstanceOf(Error);
    expect((toolResult!.error as Error).message).toBe("tool call denied: not allowed");

    // The denial was threaded into the transcript so the next model turn sees it.
    const secondTurn = engine.turns[1]!;
    const toolMessage = secondTurn[secondTurn.length - 1]!;
    expect(toolMessage.role).toBe("tool");
    const part = (toolMessage.content as { type: string; error?: unknown }[])[0]!;
    expect(part.error).toBeInstanceOf(Error);
  });

  test("edit → tool runs with the edited args, recorded in the transcript", async () => {
    const sink = { ran: false, args: undefined as unknown };
    const tool = makeTool(sink);
    const engine = mockEngine([
      [{ type: "tool-call", id: "c1", name: "act", args: { x: 1 } }],
      [{ type: "text-delta", text: "ok" }],
    ]);
    const approval: ApprovalPolicy = {
      required: true,
      decide: async (): Promise<ApprovalDecision> => ({ action: "edit", args: { x: 99 } }),
    };

    await collect(agent(engine, [user("go")], { tools: [tool], approval }));

    expect(sink.ran).toBe(true);
    expect(sink.args).toEqual({ x: 99 });

    // The assistant tool-use turn reflects the EDITED args (not the model's original).
    const secondTurn = engine.turns[1]!;
    expect(secondTurn[1]).toEqual({
      role: "assistant",
      content: [{ type: "tool-use", id: "c1", name: "act", args: { x: 99 } }],
    });
    expect(secondTurn[2]).toEqual({
      role: "tool",
      content: [{ type: "tool-result", id: "c1", result: "done" }],
    });
  });

  test("required predicate → only the named tool is gated, others auto-run", async () => {
    const gatedRan = { ran: false, args: undefined as unknown };
    const freeRan = { ran: false, args: undefined as unknown };
    const gated: AgentTool = {
      name: "gated",
      run: (a: unknown): string => {
        gatedRan.ran = true;
        gatedRan.args = a;
        return "g";
      },
    };
    const free: AgentTool = {
      name: "free",
      run: (a: unknown): string => {
        freeRan.ran = true;
        freeRan.args = a;
        return "f";
      },
    };
    const engine = mockEngine([
      [
        { type: "tool-call", id: "c1", name: "gated", args: {} },
        { type: "tool-call", id: "c2", name: "free", args: {} },
      ],
      [{ type: "text-delta", text: "ok" }],
    ]);
    const seen: string[] = [];
    const approval: ApprovalPolicy = {
      required: (call): boolean => call.name === "gated",
      decide: async (request): Promise<ApprovalDecision> => {
        seen.push(request.name);
        return { action: "approve" };
      },
    };

    const frames = await collect(agent(engine, [user("go")], { tools: [gated, free], approval }));

    // Only the gated tool went through the decision transport.
    expect(seen).toEqual(["gated"]);
    const requests = frames.filter((f) => f.type === "approval-request");
    expect(requests).toHaveLength(1);
    expect((requests[0] as { name: string }).name).toBe("gated");
    // Both tools ultimately ran (gated was approved, free auto-ran).
    expect(gatedRan.ran).toBe(true);
    expect(freeRan.ran).toBe(true);
  });

  test("no approval option → tool auto-runs (back-compat, no approval frames)", async () => {
    const sink = { ran: false, args: undefined as unknown };
    const tool = makeTool(sink);
    const engine = mockEngine([
      [{ type: "tool-call", id: "c1", name: "act", args: { x: 1 } }],
      [{ type: "text-delta", text: "ok" }],
    ]);

    const frames = await collect(agent(engine, [user("go")], { tools: [tool] }));

    expect(sink.ran).toBe(true);
    expect(frames.some((f) => f.type === "approval-request")).toBe(false);
    expect(frames.some((f) => f.type === "approval-decision")).toBe(false);
  });

  test("abort while awaiting a decision → the loop returns cleanly", async () => {
    const sink = { ran: false, args: undefined as unknown };
    const tool = makeTool(sink);
    const controller = new AbortController();
    const engine = mockEngine([[{ type: "tool-call", id: "c1", name: "act", args: {} }]]);

    // A decider that never resolves — the abort is what must unwedge the loop.
    const approval: ApprovalPolicy = {
      required: true,
      decide: (): Promise<ApprovalDecision> => {
        // Fire the abort once the loop is awaiting the decision.
        queueMicrotask(() => controller.abort());
        return new Promise<ApprovalDecision>(() => {});
      },
    };

    const frames = await collect(agent(engine, [user("go")], { tools: [tool], approval, signal: controller.signal }));

    expect(sink.ran).toBe(false);
    expect(frames.some((f) => f.type === "done")).toBe(false);
    expect(frames.some((f) => f.type === "approval-request")).toBe(true);
    // No decision was ever emitted — the loop bailed on the abort.
    expect(frames.some((f) => f.type === "approval-decision")).toBe(false);
  });
});

describe("mux-backed approval transport", () => {
  test("decide publishes a request; a subscriber publishes a decision back; the promise resolves", async () => {
    const decide = muxApprovalDecider("run-1");

    // An approver subscribing to the run's channel receives the request and answers with a decision.
    const hub = agentApprovalHub(agentApprovalChannelName("run-1", "call-a"));
    const iterator = hub.subscribe();
    const approver = (async (): Promise<void> => {
      while (true) {
        const next = await iterator.next();
        if (next.done) return;
        const frame: ApprovalChannelFrame = next.value;
        if (frame.kind === "request") {
          publishApprovalDecision("run-1", "call-a", { action: "edit", args: { edited: true } });
          return;
        }
      }
    })();

    const decision = await decide({ id: "call-a", name: "act", args: { edited: false } });
    await approver;
    await iterator.return?.();

    expect(decision).toEqual({ action: "edit", args: { edited: true } });
  });

  test("mux decider drives the loop end-to-end", async () => {
    const sink = { ran: false, args: undefined as unknown };
    const tool = makeTool(sink);
    const engine = mockEngine([
      [{ type: "tool-call", id: "call-b", name: "act", args: { x: 1 } }],
      [{ type: "text-delta", text: "ok" }],
    ]);

    // Approver stands by on the channel and approves whatever request arrives.
    const hub = agentApprovalHub(agentApprovalChannelName("run-2", "call-b"));
    const iterator = hub.subscribe();
    const approver = (async (): Promise<void> => {
      while (true) {
        const next = await iterator.next();
        if (next.done) return;
        if (next.value.kind === "request") {
          publishApprovalDecision("run-2", "call-b", { action: "approve" });
          return;
        }
      }
    })();

    const approval: ApprovalPolicy = { required: true, decide: muxApprovalDecider("run-2") };
    const frames = await collect(agent(engine, [user("go")], { tools: [tool], approval }));
    await approver;
    await iterator.return?.();

    expect(sink.ran).toBe(true);
    expect(frames).toContainEqual({ type: "approval-decision", id: "call-b", action: "approve" });
  });
});
