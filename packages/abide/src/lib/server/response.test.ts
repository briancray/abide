import { describe, expect, test } from "bun:test";
import { json } from "./json.ts";
import { error } from "./error.ts";
import { redirect } from "./redirect.ts";
import { jsonl } from "./jsonl.ts";
import { sse } from "./sse.ts";

// Drain a streaming response body to a single decoded string, proving the ReadableStream
// path runs to completion.
async function drain(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

describe("json", () => {
  test("sets content-type, serializes body, defaults to 200", async () => {
    const response = json({ hello: "world", n: 1 });
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hello: "world", n: 1 });
  });

  test("honors a custom status and merges headers", async () => {
    const response = json({ ok: true }, { status: 201, headers: { "x-trace": "abc" } });
    expect(response.status).toBe(201);
    expect(response.headers.get("x-trace")).toBe("abc");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ ok: true });
  });

  test("does not override a caller-supplied content-type", async () => {
    const response = json({ a: 1 }, { headers: { "content-type": "application/problem+json" } });
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });
});

describe("error", () => {
  test("builds a JSON error body with status, statusText, message", async () => {
    const response = error(404, "not here");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ status: 404, statusText: "Not Found", message: "not here" });
  });

  test("falls back to the status reason phrase when no message is given", async () => {
    const response = error(500);
    const body = (await response.json()) as { status: number; statusText: string; message: string };
    expect(body.status).toBe(500);
    expect(body.statusText).toBe("Internal Server Error");
    expect(body.message).toBe("Internal Server Error");
  });
});

describe("error.typed", () => {
  test("factory marks the typed name and carries data in body + marker", async () => {
    const rateLimited = error.typed("RateLimited", 429);
    const response = rateLimited({ retryAfter: 30 });
    expect(response.status).toBe(429);
    expect(response.__typedErrorName).toBe("RateLimited");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.name).toBe("RateLimited");
    expect(body.__typedError).toBe("RateLimited");
    expect(body.data).toEqual({ retryAfter: 30 });
  });

  test("factory works with no data argument", async () => {
    const forbidden = error.typed("Forbidden", 403);
    const response = forbidden();
    expect(response.status).toBe(403);
    expect(response.__typedErrorName).toBe("Forbidden");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.name).toBe("Forbidden");
    expect(body.data).toBeUndefined();
  });
});

describe("redirect", () => {
  test("sets Location and defaults to 302", () => {
    const response = redirect("/login");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  test("honors an explicit status", () => {
    const response = redirect("/moved", 301);
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/moved");
  });
});

describe("jsonl", () => {
  test("streams N newline-delimited JSON lines from an async iterable", async () => {
    async function* source() {
      yield { i: 1 };
      yield { i: 2 };
      yield { i: 3 };
    }
    const response = jsonl(source());
    expect(response.headers.get("content-type")).toBe("application/jsonl");
    const text = await drain(response);
    const lines = text.split("\n").filter((line) => line.length > 0);
    expect(lines.length).toBe(3);
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ i: 1 }, { i: 2 }, { i: 3 }]);
    expect(text.endsWith("\n")).toBe(true);
  });

  test("streams from a sync iterable", async () => {
    const response = jsonl([1, 2, "three", { four: 4 }]);
    const text = await drain(response);
    const lines = text.split("\n").filter((line) => line.length > 0);
    expect(lines.length).toBe(4);
    expect(lines.map((line) => JSON.parse(line))).toEqual([1, 2, "three", { four: 4 }]);
  });
});

describe("sse", () => {
  test("emits N data: frames from an async iterable", async () => {
    async function* source() {
      yield { tick: 1 };
      yield { tick: 2 };
    }
    const response = sse(source());
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const text = await drain(response);
    const frames = text.split("\n\n").filter((frame) => frame.length > 0);
    expect(frames.length).toBe(2);
    expect(frames[0]).toBe(`data: ${JSON.stringify({ tick: 1 })}`);
    expect(frames[1]).toBe(`data: ${JSON.stringify({ tick: 2 })}`);
  });

  test("emits frames from a sync iterable", async () => {
    const response = sse(["a", "b", "c"]);
    const text = await drain(response);
    const frames = text.split("\n\n").filter((frame) => frame.length > 0);
    expect(frames.length).toBe(3);
    expect(frames.map((frame) => JSON.parse(frame.replace(/^data: /, "")))).toEqual(["a", "b", "c"]);
  });
});
