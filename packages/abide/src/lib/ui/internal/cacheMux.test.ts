// PR5 — CLIENT auto-subscribe + apply for the server SHARED cache broadcast (shared-cache-plan
// §2.5). Three layers of coverage:
//   1. applyCacheFrame — the focused "given an inbound CacheFrame, drive the right local cell verb
//      with the right args" unit (this IS the handler the client proxy registers on the mux).
//   2. clientProxy auto-subscribe — a `shared` read joins its `@rpc:` channel with the RAW args,
//      dedups per args, and a NON-shared read never subscribes (fake WS, no real network/server).
//   3. End-to-end delivery — the real router broadcasts a `shared` amend to an AUTHORIZED WS
//      subscriber (the same frame protocol the mux speaks); the frame drives applyCacheFrame into a
//      real client cell, mirroring the server value locally.

import { test, expect, afterEach } from "bun:test";
import { createTestApp, type TestApp } from "../../test/createTestApp.ts";
import { GET } from "../../server/GET.ts";
import { clientProxy } from "./clientProxy.ts";
import { applyCacheFrame } from "./applyCacheFrame.ts";
import { subscribeCacheChannel } from "./cacheMux.ts";
import { cell } from "../../shared/cell.ts";
import { cacheChannelName } from "../../shared/internal/cacheChannelName.ts";
import type { CacheFrame } from "../../server/internal/cacheChannels.ts";
import type { Rpc } from "../../server/internal/makeRpc.ts";

let running: TestApp | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// 1. applyCacheFrame — frame → local verb mapping
// ---------------------------------------------------------------------------

test("applyCacheFrame drives the matching local cell verb with the subscribed args", () => {
  let calls = 0;
  const c = cell<{ id: string }, string>(async ({ id }) => `load-${id}#${++calls}`);

  // amend value-form → the local value reflects the broadcast value for THOSE args.
  c.seed({ id: "A" }, "seed-A");
  applyCacheFrame(c, { id: "A" }, { verb: "amend", value: "broadcast-A" });
  expect(c.peek({ id: "A" })).toBe("broadcast-A");

  // invalidate → the slot drops to idle (lazy reload on next read), value cleared.
  applyCacheFrame(c, { id: "A" }, { verb: "invalidate" });
  expect(c.peek({ id: "A" })).toBeUndefined();

  // refresh → eager revalidation on the retained slot (re-runs the loader).
  c.seed({ id: "B" }, "seed-B");
  applyCacheFrame(c, { id: "B" }, { verb: "refresh" });
  expect(c.refreshing({ id: "B" })).toBe(true);
});

// ---------------------------------------------------------------------------
// 2. subscribeCacheChannel is a hard no-op under SSR (no window / WebSocket)
// ---------------------------------------------------------------------------

test("subscribeCacheChannel is a no-op under SSR (no window)", () => {
  // The bun test process has `window` deleted (happy-dom preload), i.e. the SSR condition. The mux
  // must not throw and must not construct a socket.
  expect(typeof window).toBe("undefined");
  let applied = false;
  expect(() => subscribeCacheChannel("@rpc:x:key", { id: "A" }, () => (applied = true))).not.toThrow();
  expect(applied).toBe(false);
});

// ---------------------------------------------------------------------------
// 3. clientProxy auto-subscribe: shared joins (raw args + dedup); non-shared never subscribes.
//    Fully synchronous with a fake browser env + fake WebSocket + stubbed fetch — NO real network
//    and NO server runs while `window` is set, so the shared-process side-detection is never
//    exercised by server code. Globals restored (and the mux socket reset) before the test returns.
// ---------------------------------------------------------------------------

test("shared read subscribes to its @rpc channel (raw args, dedup); non-shared does not", () => {
  const sent: string[] = [];
  const closers: (() => void)[] = [];
  class FakeWebSocket {
    readyState = 1; // pretend already OPEN so `send` fires synchronously on subscribe
    constructor(public url: string) {}
    addEventListener(type: string, fn: (event: unknown) => void): void {
      if (type === "open") fn({});
      if (type === "close") closers.push(() => fn({}));
    }
    send(data: string): void {
      sent.push(data);
    }
    close(): void {}
  }

  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, WebSocket: g.WebSocket, location: g.location, fetch: g.fetch };
  const hadWindow = "window" in g;
  g.window = {};
  g.WebSocket = FakeWebSocket as unknown;
  g.location = { protocol: "https:", host: "app.test" };
  g.fetch = (): Promise<Response> =>
    Promise.resolve(new Response(JSON.stringify({ ok: 1 }), { headers: { "content-type": "application/json" } }));

  try {
    const shared = clientProxy<{ id: string }, unknown>("prof", "GET", { shared: true }) as Rpc<{ id: string }, unknown>;
    const plain = clientProxy<{ id: string }, unknown>("plain", "GET", { shared: false }) as Rpc<{ id: string }, unknown>;

    // Reactive reads: ensureSubscribe fires synchronously (before the async fetch settles).
    shared({ id: "A" }); // shared → subscribe channel A
    shared({ id: "A" }); // same args → dedup, no second subscribe
    shared({ id: "B" }); // different args → subscribe channel B
    plain({ id: "A" }); // non-shared → never subscribes

    const frames = sent.map((raw) => JSON.parse(raw) as { t: string; name: string; args: unknown });
    // Exactly two subscribes (A once + B once); the duplicate A and the non-shared read added none.
    expect(frames.length).toBe(2);
    expect(frames[0]).toEqual({ t: "sub", name: cacheChannelName("prof", { id: "A" }), args: { id: "A" } });
    expect(frames[1]).toEqual({ t: "sub", name: cacheChannelName("prof", { id: "B" }), args: { id: "B" } });
    // Never an @rpc:plain channel — a non-shared read does not subscribe.
    expect(frames.some((frame) => frame.name.startsWith("@rpc:plain:"))).toBe(false);
  } finally {
    for (const close of closers) close(); // reset the mux socket singleton (fires its close listener)
    if (hadWindow) g.window = saved.window;
    else delete g.window;
    g.WebSocket = saved.WebSocket;
    g.location = saved.location;
    g.fetch = saved.fetch;
  }
});

// ---------------------------------------------------------------------------
// 4. End-to-end: real server broadcast → authorized WS subscriber → applyCacheFrame mirrors locally.
// ---------------------------------------------------------------------------

test("server shared-amend broadcast reaches an authorized subscriber and applies to a local cell", async () => {
  const prof = GET(({ id }: { id: string }) => ({ id, secret: `secret-${id}` }), { cache: { shared: true } });
  running = createTestApp({ routes: { prof: prof } });

  const args = { id: "A" };
  const socket = running.socket();
  const stream = socket.subscribe<CacheFrame>(cacheChannelName("prof", args), args);
  await socket.ready();
  await delay(80); // let the async authorize+join complete before publishing

  const value = { id: "A", secret: "amended" };
  (prof as Rpc<{ id: string }, { id: string; secret: string }>).amend(args, value);

  const iterator = stream[Symbol.asyncIterator]();
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5000));
  const frame = await Promise.race([iterator.next().then((r) => r.value), timeout]);
  expect(frame).toEqual({ verb: "amend", value });

  // Drive the received frame into a fresh client cell — its local value mirrors the server broadcast.
  const clientCell = cell<{ id: string }, { id: string; secret: string }>(async () => ({ id: "A", secret: "stale" }));
  clientCell.seed(args, { id: "A", secret: "stale" });
  applyCacheFrame(clientCell, args, frame as CacheFrame);
  expect(clientCell.peek(args)).toEqual(value);

  socket.close();
});
