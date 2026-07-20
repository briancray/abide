// Mutation cache routing — build step 2 (replayable-streams.md §1).
//
// Mutations now route through a cell defaulting to `cache: { ttl: 0 }`: coalesce identical CONCURRENT
// in-flight calls WITHIN a request scope, retain nothing after settle. Separate request scopes never
// share a slot (at-least-once across requests preserved). `cache: false` opts out entirely; a FormData
// body always bypasses the cell (it can't be safely keyed).

import { afterEach, describe, expect, test } from "bun:test";
import { POST } from "../POST.ts";
import { anonymousPrincipal, runInScope, type RequestScope } from "./scope.ts";
import { sharedStore } from "../../shared/internal/sharedCache.ts";

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

afterEach(() => {
  sharedStore().clear(); // shared cells are process-global — isolate cross-test
});

describe("mutation ttl:0 default — coalesce concurrent within a scope", () => {
  test("two identical CONCURRENT calls in one scope run the handler ONCE", async () => {
    let runs = 0;
    const m = POST(async (_args: { x: number }) => {
      runs++;
      await sleep(5);
      return runs;
    });

    await runInScope(makeScope(), async () => {
      const [a, b] = await Promise.all([m({ x: 1 }), m({ x: 1 })]);
      expect(runs).toBe(1);
      expect(a).toBe(b); // both callers observe the single coalesced result
    });
  });

  test("two SEQUENTIAL identical calls in one scope run the handler TWICE (ttl:0 retains nothing)", async () => {
    let runs = 0;
    const m = POST(async (_args: { x: number }) => {
      runs++;
      return runs;
    });

    await runInScope(makeScope(), async () => {
      await m({ x: 1 });
      await m({ x: 1 });
      expect(runs).toBe(2);
    });
  });

  test("the same call issued in SEPARATE scopes runs each time (per-request scopes don't share)", async () => {
    let runs = 0;
    const m = POST(async (_args: { x: number }) => {
      runs++;
      return runs;
    });

    await runInScope(makeScope(), () => m({ x: 1 }));
    await runInScope(makeScope(), () => m({ x: 1 }));
    expect(runs).toBe(2);
  });

  test("different-arg concurrent calls never coalesce", async () => {
    let runs = 0;
    const m = POST(async (_args: { x: number }) => {
      runs++;
      await sleep(5);
      return runs;
    });
    await runInScope(makeScope(), async () => {
      await Promise.all([m({ x: 1 }), m({ x: 2 })]);
      expect(runs).toBe(2);
    });
  });
});

describe("mutation cache: false — full opt-out", () => {
  test("concurrent identical calls each execute (no coalescing)", async () => {
    let runs = 0;
    const m = POST(
      async (_args: { x: number }) => {
        runs++;
        await sleep(5);
        return runs;
      },
      { cache: false },
    );
    await runInScope(makeScope(), async () => {
      await Promise.all([m({ x: 1 }), m({ x: 1 })]);
      expect(runs).toBe(2);
    });
  });
});

describe("mutation shared ttl:0 — cross-request coalescing collapses side effects", () => {
  test("two concurrent identical cross-scope calls run the (scope-exited) handler once", async () => {
    let runs = 0;
    const m = POST(
      async (args: { id: number }) => {
        runs++; // the single side effect a coalesced shared run must fire exactly once
        await sleep(5);
        return args.id;
      },
      { cache: { ttl: 0, shared: true } },
    );

    const a = runInScope(makeScope(), () => m({ id: 7 }));
    const b = runInScope(makeScope(), () => m({ id: 7 }));
    const [ra, rb] = await Promise.all([a, b]);
    expect(runs).toBe(1);
    expect(ra).toBe(7);
    expect(rb).toBe(7);
  });
});

describe("mutation FormData — always bypasses the cell", () => {
  test("two distinct concurrent uploads both execute (never conflated to one key)", async () => {
    let runs = 0;
    const m = POST(async (_form: { file: string }) => {
      runs++;
      await sleep(5);
      return runs;
    });

    const a = new FormData();
    a.append("file", "cat.jpg");
    const b = new FormData();
    b.append("file", "dog.jpg");

    await runInScope(makeScope(), async () => {
      await Promise.all([m(a), m(b)]);
      expect(runs).toBe(2);
    });
  });
});

describe("mutation public surface stays call-only", () => {
  test("no reactive probes are exposed; __rpc.read is false", () => {
    const m = POST((_args: { x: number }) => 1) as unknown as Record<string, unknown>;
    expect(typeof m).toBe("function");
    expect(m.peek).toBeUndefined();
    expect(m.amend).toBeUndefined();
    expect(m.pending).toBeUndefined();
    expect((m.__rpc as { read: boolean }).read).toBe(false);
  });
});
