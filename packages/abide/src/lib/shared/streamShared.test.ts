// Shared streaming reads + byte accounting + per-stream cap — build step 3 (replayable-streams.md §2/§4).
//
// A `shared` streaming read stores its ReplayableStream in the process-global sharedStore(): one source
// run serves concurrent/late cross-request consumers. Its transcript is accounted incrementally against
// ABIDE_MAX_SHARED_CACHE_SIZE (open streams PINNED, never evicted mid-flight), and bounded by the
// per-stream cap ABIDE_MAX_STREAM_BUFFER_SIZE (exceed → OVERFLOW: aborted, no replay, late joiner re-runs).

import { afterEach, describe, expect, test } from "bun:test";
import { cell } from "./cell.ts";
import { anonymousPrincipal, runInScope, type RequestScope } from "../server/internal/scope.ts";
import { sharedStore } from "./internal/sharedCache.ts";

function makeScope(): RequestScope {
  const url = new URL("http://localhost/test");
  return {
    request: new Request(url),
    cookies: new Bun.CookieMap(),
    identity: anonymousPrincipal(),
    bag: {},
    route: { kind: "rpc", name: "test", params: {}, url, navigating: false },
    cache: new Map<string, unknown>(),
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function drain<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iter) values.push(value);
  return values;
}

afterEach(() => {
  sharedStore().clear();
  delete Bun.env.ABIDE_MAX_SHARED_CACHE_SIZE;
  delete Bun.env.ABIDE_MAX_STREAM_BUFFER_SIZE;
});

describe("shared streaming — one run across requests", () => {
  test("two concurrent cross-request reads share ONE run; a late joiner within ttl replays", async () => {
    let runs = 0;
    const c = cell<{ id: number }, AsyncIterable<number>>(
      async function* (args) {
        runs++;
        for (let i = 0; i < args.id; i++) {
          await sleep(3);
          yield i;
        }
      },
      { shared: true, ttl: 10_000 },
    );

    const a = runInScope(makeScope(), async () => drain(await c({ id: 3 })));
    const b = runInScope(makeScope(), async () => drain(await c({ id: 3 })));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual([0, 1, 2]);
    expect(rb).toEqual([0, 1, 2]);
    expect(runs).toBe(1);

    const late = await runInScope(makeScope(), async () => drain(await c({ id: 3 })));
    expect(late).toEqual([0, 1, 2]);
    expect(runs).toBe(1); // replayed from the retained transcript, no re-run
  });
});

describe("shared streaming — byte accounting & eviction", () => {
  test("a closed stream's bytes count toward the ceiling and evict an older slot", async () => {
    Bun.env.ABIDE_MAX_SHARED_CACHE_SIZE = "100";

    let olderRuns = 0;
    const older = cell<{ k: string }, string>(
      () => {
        olderRuns++;
        return "x".repeat(40); // JSON ~42 bytes
      },
      { shared: true },
    );
    await runInScope(makeScope(), () => older({ k: "a" }));
    expect(olderRuns).toBe(1);

    const streamer = cell<{ k: string }, AsyncIterable<string>>(
      async function* () {
        yield "y".repeat(80); // JSON ~82 bytes → 42 + 82 = 124 > 100
      },
      { shared: true, ttl: 10_000 },
    );
    await runInScope(makeScope(), async () => drain(await streamer({ k: "b" })));

    // The older (LRU) slot was evicted to fit the stream → reading it re-runs.
    await runInScope(makeScope(), () => older({ k: "a" }));
    expect(olderRuns).toBe(2);
  });
});

describe("shared streaming — per-stream cap (overflow)", () => {
  test("a stream past the cap is bounded, drops replay, and a late joiner re-runs", async () => {
    Bun.env.ABIDE_MAX_STREAM_BUFFER_SIZE = "60"; // tiny cap

    let runs = 0;
    const c = cell<Record<string, never>, AsyncIterable<string>>(
      async function* () {
        runs++;
        for (let i = 0; i < 100; i++) {
          await sleep(1);
          yield "z".repeat(20); // ~22 bytes each → overflow after ~3 chunks
        }
      },
      { shared: true, ttl: 10_000 },
    );

    const first = await runInScope(makeScope(), async () => drain(await c({})));
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(100); // did NOT buffer all 100 → bounded
    expect(runs).toBe(1);

    const late = await runInScope(makeScope(), async () => drain(await c({})));
    expect(runs).toBe(2); // overflowed transcript is not a replay target → re-run
  });
});

describe("shared streaming — open stream is pinned", () => {
  test("an open stream is never LRU-evicted; a concurrent read still coalesces under a tiny ceiling", async () => {
    Bun.env.ABIDE_MAX_SHARED_CACHE_SIZE = "10"; // absurdly tiny — would evict a closed slot immediately

    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const c = cell<Record<string, never>, AsyncIterable<string>>(
      async function* () {
        runs++;
        yield "a".repeat(20); // ~22 bytes > 10 → eviction pressure while open
        yield "b".repeat(20);
        await gate; // park the source OPEN
        yield "c".repeat(20);
      },
      { shared: true, ttl: 10_000 },
    );

    const collectedA: string[] = [];
    const readerA = runInScope(makeScope(), async () => {
      for await (const v of await c({})) collectedA.push(v);
    });
    await sleep(10); // 2 chunks flushed; the OPEN stream is pinned despite exceeding the ceiling

    const collectedB: string[] = [];
    const readerB = runInScope(makeScope(), async () => {
      for await (const v of await c({})) collectedB.push(v);
    });
    await sleep(10);
    release();
    await Promise.all([readerA, readerB]);

    expect(runs).toBe(1); // B coalesced onto A's run → the open stream slot was NOT evicted
    expect(collectedA.length).toBe(3);
    expect(collectedB.length).toBe(3);
  });
});
