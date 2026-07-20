import { describe, expect, test } from "bun:test";
import { cacheChannelName, cacheChannelHub, publishCacheFrame, type CacheFrame } from "./cacheChannels.ts";
import { makeRead, type Rpc } from "./makeRpc.ts";
import { createApp } from "./router.ts";
import { runInScope, anonymousPrincipal, type RequestScope } from "./scope.ts";

// A minimal request scope so a shared read's fail-closed `guardSharedRead` (requires an active
// scope) is satisfied while loading the durable value.
function makeScope(name: string): RequestScope {
  const request = new Request(`http://localhost/rpc/${name}`);
  return {
    request,
    cookies: new Bun.CookieMap(""),
    identity: anonymousPrincipal(),
    bag: {},
    route: { kind: "rpc", name, params: {}, url: new URL(request.url), navigating: false },
    cache: new Map<string, unknown>(),
  };
}

// The channel publish closure createApp binds — replicated so tests can bind a bare route without
// standing up a server. Kept identical to router.createApp so the two stay in lock-step.
function bindLikeCreateApp(route: Rpc<any, any>, name: string): void {
  route.bindBroadcast((verb, args, value): void => {
    const frame: CacheFrame = verb === "amend" ? { verb, value } : { verb };
    publishCacheFrame(cacheChannelName(name, args), frame);
  });
}

// Resolve the next frame, or a timeout sentinel if none arrives — for asserting NON-broadcast.
const TIMEOUT = Symbol("timeout");
async function nextOrTimeout(iterator: AsyncIterator<CacheFrame>, ms: number): Promise<CacheFrame | typeof TIMEOUT> {
  const timeout = new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), ms));
  const next = iterator.next().then((result) => result.value as CacheFrame);
  return Promise.race([next, timeout]);
}

describe("cacheChannels — broadcast substrate", () => {
  test("shared read invalidate/refresh broadcast their verb onto the (rpc,args) channel", async () => {
    const profile = makeRead("GET", async ({ id }: { id: number }) => ({ id, name: `n${id}` }), { cache: { shared: true } });
    bindLikeCreateApp(profile, "profileA");

    const invIter = cacheChannelHub(cacheChannelName("profileA", { id: 1 })).subscribe();
    profile.invalidate({ id: 1 });
    expect((await invIter.next()).value).toEqual({ verb: "invalidate" });
    await invIter.return?.();

    const refIter = cacheChannelHub(cacheChannelName("profileA", { id: 1 })).subscribe();
    profile.refresh({ id: 1 });
    expect((await refIter.next()).value).toEqual({ verb: "refresh" });
    await refIter.return?.();
  });

  test("shared read value-form amend broadcasts {verb:'amend', value}", async () => {
    const profile = makeRead("GET", async ({ id }: { id: number }) => ({ id, count: 0 }), { cache: { shared: true } });
    bindLikeCreateApp(profile, "profileB");

    const iter = cacheChannelHub(cacheChannelName("profileB", { id: 1 })).subscribe();
    const value = { id: 1, count: 7 };
    profile.amend({ id: 1 }, value);
    expect((await iter.next()).value).toEqual({ verb: "amend", value });
    await iter.return?.();
  });

  test("shared read updater-form amend broadcasts the RESOLVED value", async () => {
    const profile = makeRead("GET", async ({ id }: { id: number }) => ({ id, count: 1 }), { cache: { shared: true } });
    bindLikeCreateApp(profile, "profileC");

    // Seed the durable value inside a request scope (shared reads require an active scope).
    await runInScope(makeScope("profileC"), async () => {
      await profile.load({ id: 1 });
    });

    const iter = cacheChannelHub(cacheChannelName("profileC", { id: 1 })).subscribe();
    profile.amend({ id: 1 }, (current) => ({ id: 1, count: (current?.count ?? 0) + 41 }));
    // Durable value was { id:1, count:1 } → updater result { id:1, count:42 } broadcast value-form.
    expect((await iter.next()).value).toEqual({ verb: "amend", value: { id: 1, count: 42 } });
    await iter.return?.();
  });

  test("non-shared read does NOT broadcast even when a sink is bound", async () => {
    const profile = makeRead("GET", async ({ id }: { id: number }) => ({ id }));
    bindLikeCreateApp(profile, "profileD");

    const iter = cacheChannelHub(cacheChannelName("profileD", { id: 1 })).subscribe();
    profile.invalidate({ id: 1 });
    profile.amend({ id: 1 }, { id: 99 });
    expect(await nextOrTimeout(iter, 25)).toBe(TIMEOUT);
    await iter.return?.();
  });

  test("createApp binds shared read broadcast via the route name seam", async () => {
    const profile = makeRead("GET", async ({ id }: { id: number }) => ({ id }), { cache: { shared: true } });
    const app = createApp({ routes: { profileE: profile } });
    try {
      const iter = cacheChannelHub(cacheChannelName("profileE", { id: 5 })).subscribe();
      profile.invalidate({ id: 5 });
      expect((await iter.next()).value).toEqual({ verb: "invalidate" });
      await iter.return?.();
    } finally {
      await app.stop();
    }
  });

  test("channel names are deterministic, args/rpc-sensitive, and cannot collide with bare socket names", () => {
    expect(cacheChannelName("profile", { id: 1 })).toBe(cacheChannelName("profile", { id: 1 }));
    expect(cacheChannelName("profile", { id: 1 })).not.toBe(cacheChannelName("profile", { id: 2 }));
    expect(cacheChannelName("profile", { id: 1 })).not.toBe(cacheChannelName("other", { id: 1 }));
    // Order-independent args → same key (canonicalKey sorts object keys).
    expect(cacheChannelName("profile", { a: 1, b: 2 })).toBe(cacheChannelName("profile", { b: 2, a: 1 }));
    // Reserved namespace: a channel name starts with `@rpc:` and carries a `:`, so a bare user
    // socket name (config.sockets key, no `@`/`:`) can never equal it.
    const name = cacheChannelName("profile", { id: 1 });
    expect(name.startsWith("@rpc:")).toBe(true);
    expect(name).not.toBe("profile");
  });
});
