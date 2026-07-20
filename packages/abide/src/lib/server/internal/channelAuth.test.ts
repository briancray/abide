// SECURITY-CRITICAL adversarial matrix for `@rpc:` cache-channel join authorization
// (shared-cache-plan §2.3 + §3). A WS client may subscribe to a `(rpc,args)` cache channel ONLY
// if it passes the SAME gate that authorizes reading `(rpc,args)` — the target rpc's own
// middleware chain, re-run with the connection's identity + the subscribe frame's raw args, PER
// SUBSCRIBE. Every case boots the real router via createTestApp (no mocks) and drives it over the
// live WS mux with the extended `socketClient` (which sends `args` and a sealed Bearer identity).

import { afterEach, describe, expect, test } from "bun:test";
import { createTestApp, type SocketClient, type TestApp } from "../../test/createTestApp.ts";
import { makeRead, type Rpc } from "./makeRpc.ts";
import { cacheChannelName } from "./cacheChannels.ts";
import { request } from "../request.ts";
import { identity } from "../identity.ts";
import { error } from "../error.ts";
import type { Middleware } from "./middleware.ts";

const TEST_TIMEOUT = 5000;

let running: TestApp | undefined;
const openClients: SocketClient[] = [];

function track(app: TestApp): TestApp {
  running = app;
  return app;
}

function client(app: TestApp): SocketClient {
  const c = app.socket();
  openClients.push(c);
  return c;
}

afterEach(async () => {
  for (const c of openClients) c.close();
  openClients.length = 0;
  if (running !== undefined) {
    await running.stop();
    running = undefined;
  }
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Resolve the next frame off a subscription, or a timeout sentinel if none arrives in `ms` — the
// core assertion for "denied join is silent + no fanout" (a leaked frame fails the test).
const TIMEOUT = Symbol("timeout");
async function nextOrTimeout<T>(iterable: AsyncIterable<T>, ms: number): Promise<T | typeof TIMEOUT> {
  const iterator = iterable[Symbol.asyncIterator]();
  const timeout = new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), ms));
  const next = iterator.next().then((result) => result.value as T);
  return Promise.race([next, timeout]);
}

// Read the args a read handler's middleware would see on the HTTP GET path: from the request URL
// `?args=` query. Identical on both the real HTTP read AND the synthetic channel-join scope (which
// reconstructs the same `/rpc/<name>?args=` request), so ONE middleware gates both paths.
function readArgs(): { id?: string } {
  const url = new URL(request().url);
  const raw = url.searchParams.get("args");
  return raw !== null ? (JSON.parse(raw) as { id?: string }) : {};
}

// Row-level guard: only the row's owner may read (or join the channel for) `profile({id})`.
const guardOwnRow: Middleware = (next) => {
  if (identity().id !== readArgs().id) return error(403, "not your row");
  return next();
};

// A shared GET read gated by `guardOwnRow`. Distinct route name per test keeps the process-global
// channel registry from sharing a hub across tests.
function guardedProfile(): Rpc<{ id: string }, { id: string; secret: string }> {
  return makeRead("GET", async ({ id }: { id: string }) => ({ id, secret: `secret-${id}` }), {
    cache: { shared: true },
    middleware: [guardOwnRow],
  });
}

// A shared GET read with NO middleware — public, so any identity (incl. anonymous) may join.
function publicProfile(): Rpc<{ id: string }, { id: string; open: boolean }> {
  return makeRead("GET", async ({ id }: { id: string }): Promise<{ id: string; open: boolean }> => ({ id, open: true }), { cache: { shared: true } });
}

describe("channelAuth — @rpc: cache-channel join authorization", () => {
  // 1. Baseline: the middleware ALLOWS the owner's HTTP read (so a later denial is the gate, not a
  //    broken handler).
  test("baseline — the owner's HTTP read of its own row is 200", async () => {
    const profile = guardedProfile();
    const app = track(createTestApp({ routes: { profile1: profile } }));
    const asA = app.as({ id: "A" });

    const allowed = (await asA.rpc.profile1!({ id: "A" })) as { id: string; secret: string };
    expect(allowed).toEqual({ id: "A", secret: "secret-A" });

    // And the same middleware denies a foreign row (403 body), confirming it is a real gate.
    const denied = (await asA.rpc.profile1!({ id: "B" })) as { status: number };
    expect(denied.status).toBe(403);
  }, TEST_TIMEOUT);

  // 2. Denied join is SILENT + no fanout: A joins B's channel (presenting B's args) — the gate
  //    denies (A is not B), so a broadcast to B's channel never reaches A. A's stream must TIME OUT.
  test("denied join is silent — a foreign-row broadcast never reaches the denied subscriber", async () => {
    const profile = guardedProfile();
    const app = track(createTestApp({ routes: { profile2: profile } }));

    const a = client(app.as({ id: "A" }));
    const channelB = cacheChannelName("profile2", { id: "B" });
    const stream = a.subscribe(channelB, { id: "B" }); // A presents B's (matching) args → gate denies
    await a.ready();
    await delay(80); // let the (denied) subscribe attempt fully process server-side

    // A server-side invalidate of B's row broadcasts onto B's channel — which A never joined.
    profile.invalidate({ id: "B" });
    expect(await nextOrTimeout(stream, 250)).toBe(TIMEOUT);
  }, TEST_TIMEOUT);

  // 3. Positive: A joins its OWN channel (own args) → an amend on that channel delivers exactly the
  //    value-form frame.
  test("authorized join receives its own channel's broadcast", async () => {
    const profile = guardedProfile();
    const app = track(createTestApp({ routes: { profile3: profile } }));

    const a = client(app.as({ id: "A" }));
    const channelA = cacheChannelName("profile3", { id: "A" });
    const stream = a.subscribe(channelA, { id: "A" });
    await a.ready();
    await delay(80);

    const value = { id: "A", secret: "amended" };
    profile.amend({ id: "A" }, value);
    expect(await nextOrTimeout(stream, TEST_TIMEOUT)).toEqual({ verb: "amend", value });
  }, TEST_TIMEOUT);

  // 4. ARGS-SPOOF: name a channel A while presenting args for B (mismatch) → rejected on the
  //    `cacheChannelName(rpc, presentedArgs) === channelName` check, BEFORE any middleware runs.
  //    Even though A would be allowed to read {id:A}, the presented args do not NAME channel A, so
  //    no join happens and channel-A traffic never reaches this spoofing subscription.
  test("args-spoof — name-for-A with args-for-B is rejected on the channel-name check", async () => {
    const profile = guardedProfile();
    const app = track(createTestApp({ routes: { profile4: profile } }));

    const a = client(app.as({ id: "A" }));
    const channelA = cacheChannelName("profile4", { id: "A" });
    // Subscribe frame: name = channel-A, but args = {id:"B"} → cacheChannelName(profile,{id:B})
    // = channel-B !== channel-A → deny (no join), regardless of A's own read rights.
    const stream = a.subscribe(channelA, { id: "B" });
    await a.ready();
    await delay(80);

    // A legitimate broadcast onto channel-A must NOT reach the spoofing subscription.
    profile.amend({ id: "A" }, { id: "A", secret: "x" });
    expect(await nextOrTimeout(stream, 250)).toBe(TIMEOUT);
  }, TEST_TIMEOUT);

  // 5. PER-SUBSCRIBE (not per-connection): on ONE connection, an allowed join then a forbidden one
  //    — the second is re-authorized and DENIED, proving the check runs per subscribe.
  test("authorization is re-run per subscribe, not cached on the connection", async () => {
    const profile = guardedProfile();
    const app = track(createTestApp({ routes: { profile5: profile } }));

    const a = client(app.as({ id: "A" }));
    const channelA = cacheChannelName("profile5", { id: "A" });
    const channelB = cacheChannelName("profile5", { id: "B" });
    const allowedStream = a.subscribe(channelA, { id: "A" }); // passes
    const deniedStream = a.subscribe(channelB, { id: "B" }); // re-checked → denied
    await a.ready();
    await delay(80);

    profile.amend({ id: "A" }, { id: "A", secret: "ok" });
    profile.amend({ id: "B" }, { id: "B", secret: "leak" });

    // The allowed channel delivers; the forbidden one on the SAME connection stays silent.
    expect(await nextOrTimeout(allowedStream, TEST_TIMEOUT)).toEqual({ verb: "amend", value: { id: "A", secret: "ok" } });
    expect(await nextOrTimeout(deniedStream, 250)).toBe(TIMEOUT);
  }, TEST_TIMEOUT);

  // 6. ANONYMOUS WS (no cookie/bearer at upgrade): forbidden channels are denied; a public
  //    (middleware-less) shared channel still joins.
  test("anonymous WS — forbidden channels denied, public channel joins", async () => {
    const profile = guardedProfile();
    const open = publicProfile();
    const app = track(createTestApp({ routes: { profile6: profile, open6: open } }));

    const anon = client(app); // base app → no identity → anonymous at upgrade
    const guardedChannel = cacheChannelName("profile6", { id: "A" });
    const publicChannel = cacheChannelName("open6", { id: "A" });
    const guardedStream = anon.subscribe(guardedChannel, { id: "A" }); // anon.id !== "A" → denied
    const publicStream = anon.subscribe(publicChannel, { id: "A" }); // no middleware → allowed
    await anon.ready();
    await delay(80);

    profile.amend({ id: "A" }, { id: "A", secret: "nope" });
    open.amend({ id: "A" }, { id: "A", open: true });

    expect(await nextOrTimeout(publicStream, TEST_TIMEOUT)).toEqual({ verb: "amend", value: { id: "A", open: true } });
    expect(await nextOrTimeout(guardedStream, 250)).toBe(TIMEOUT);
  }, TEST_TIMEOUT);

  // 7. FANOUT ISOLATION: A and B each join ONLY their own channel; a per-row broadcast reaches only
  //    the matching channel's subscriber. (The whole-callable `invalidate()` broadcasts the bare
  //    selector, not per-slot — see shared-cache-plan §3 / cell broadcast semantics — so isolation
  //    is exercised with the per-row invalidates that name each slot's channel.)
  test("fanout isolation — each channel's subscriber receives only its own slot's frame", async () => {
    const profile = guardedProfile();
    const app = track(createTestApp({ routes: { profile7: profile } }));

    const a = client(app.as({ id: "A" }));
    const b = client(app.as({ id: "B" }));
    const streamA = a.subscribe(cacheChannelName("profile7", { id: "A" }), { id: "A" });
    const streamB = b.subscribe(cacheChannelName("profile7", { id: "B" }), { id: "B" });
    await a.ready();
    await b.ready();
    await delay(80);

    profile.invalidate({ id: "A" });
    profile.invalidate({ id: "B" });

    // A sees exactly one frame (its own); a second read times out (B's frame never crossed over).
    expect(await nextOrTimeout(streamA, TEST_TIMEOUT)).toEqual({ verb: "invalidate" });
    expect(await nextOrTimeout(streamA, 200)).toBe(TIMEOUT);
    expect(await nextOrTimeout(streamB, TEST_TIMEOUT)).toEqual({ verb: "invalidate" });
    expect(await nextOrTimeout(streamB, 200)).toBe(TIMEOUT);
  }, TEST_TIMEOUT);
});
