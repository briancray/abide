# ADR-0008: Bounding RPCs — client timeout, reported connectivity, handler deadline, host reachability

**Status:** accepted (2026-06-14)

## Context

Two field reports opened this: RPC fetches backed up and blocked navigation
when the machine went offline, and there was no story for an RPC handler
reaching an external host it couldn't access. Tracing both produced one
diagnosis and a connected arc of decisions.

The backup was never a client-origin problem. abide RPCs are always
same-origin (`withBase` prefixes a rooted path against `window.location`), so a
client-side "reject calls that reach outside the app" gate has nothing to
classify — the hang lived on the *server*: a handler's outbound `fetch` to a
dead host held the inbound RPC open, and ~6-connections-per-host pool
starvation queued the SPA nav resolve behind it. `ABIDE_IDLE_TIMEOUT` is
server-side (Bun's per-connection idle), so it never bounded a client fetch
that hadn't reached the server.

So "bound an RPC" is really four independent questions, each on a different
axis: how long the **browser** waits, whether the **caller** is online, how long
a **handler** may run, and whether an **external host** is reachable. This ADR
records the decision on each, plus the substrate that makes all four surface
truthfully (the error boundary). The throughline: every axis is **opt-in, never
defaulted**, and a failure is always an **honest HTTP status**, never a flat 500.

## Decision

### 1. The client RPC timeout is opt-in via env, with no default and no connectivity branch

`ABIDE_CLIENT_TIMEOUT` (ms) bounds the browser's `remoteProxy` fetch; unset =
unbounded, exactly as before. The server reads it at boot and ships it via
`__SSR__` (runtime, not build-time `define`) so the value reflects the running
server, not the build. A fire maps to a synthetic `HttpError(504)`.

Rejected:

- **A non-zero default.** Same stance as `maxBodySize` (ADR — no abide default
  cap): a framework that silently abandons requests after N seconds is a
  surprise. Opt-in only.
- **An offline/online split deadline** (short timeout when `navigator.onLine`
  is false, generous otherwise). Connectivity is decision 2's job, not the
  timeout's. A blanket online-gate also over-rejects: in a bundle the embedded
  server is on localhost and reachable while `navigator.onLine` is false, so
  shortening the deadline there would break a working app. The timeout stays a
  dumb wall-clock bound; connectivity is reported, not inferred.

### 2. Offline is client-reported; server `online()` reflects the caller, not ambient internet

A abide client fetch stamps `OFFLINE_HEADER` (`abide-offline: 1`) only when
`navigator.onLine` is false. Server `online()`, within a request scope, returns
`!req.headers.has(OFFLINE_HEADER)`; true outside any scope and for
non-abide-client requests. This makes `online()` isomorphic — same callable,
honest answer on both sides — where it was a server-side constant before.

This **revises** the prior locked decision ("`online()` is constant `true` on
the server — the server is its own backend"). That was the wrong frame for a
handler reaching *outward*: in a bundle the client and embedded server share a
machine, so the client's `navigator.onLine` *is* the server's outbound
reachability.

Rejected:

- **An ambient server connectivity probe** feeding server `online()`. There is
  no cheap, portable "is the link up" read server-side; faking it would lie.
  `online()` answers "did the calling client report itself offline," and is
  documented as such — **not** "can this server reach the internet." It is
  therefore always `true` during SSR (the initial document navigation carries
  no header) and for webhook/cron callers. Real outbound reachability is
  decision 4's separate, explicit job.
- **The client "reject outside-the-app" gate.** As above — abide RPCs are
  same-origin, so the client can't see which call provokes a server-side
  outbound hang.

### 3. A thrown HttpError surfaces as its real status and body, not 500

`errorParamsForThrow` (single-sourced by the server `renderPage` catch and the
client `showErrorView`) read the thrown value's real `HttpError.status` and its
response body as the message, instead of stamping 500. The server error render
already passes that status to the document `Response`, so a 404 RPC renders a
404 page *and* returns 404; the 503/504 from decisions 1/4/5 render honestly.

This is the substrate the other decisions stand on: the whole point of a 504
timeout or a 503 offline is lost if the boundary flattens it to 500. Non-`Http`
throws (a real bug) still default to 500 — correctly.

### 4. `reachable(host)` is a faithful first read, then a kept-warm poll

`abide/server/reachable` — `async reachable(host): Promise<boolean>` — the
**outbound** complement to `online()`'s inbound/client-reported signal. The
first call awaits a real status-agnostic HEAD to the origin; it then hands the
origin to `createLivenessWatch`, which re-probes every TTL so later reads
resolve instantly off the warm value. Status-agnostic: *any* completed HTTP
response (incl. 4xx/5xx/405) proves connectivity; only reject/timeout reads as
unreachable. Idle hosts reap.

Rejected forks (this surface was the most over-designed before settling):

- **Optimistic-`true` sync seed.** A sync read can't be faithful — there is no
  ambient source, so a truthful first answer requires a probe, which is async.
  The first read must measure, not guess.
- **A poll-only `reachable` with a separate probe URL.** Forces a "which path
  proves the host is up" choice and adds side-channel traffic the host didn't
  ask for. The HEAD to the *origin* answers host connectivity (the actual
  question); endpoint health is the caller's response-status + timeout job.
- **An outcome-fed circuit breaker keyed to the app's own calls.** Elegant in
  theory, but the predicate only knows what calls routed through its wrapper
  reported — gate on `reachable()` while calling with a bare `fetch` and the
  breaker is wired to nothing. And the first call is structurally unprotected.
- **A 500 ms timeout.** The timeout bounds *network wall-clock* (DNS + TCP +
  TLS over a distant or mobile link), not server processing — 500 ms
  false-negatives a healthy-but-distant host, the worse error. Down-detection
  speed is set by the TTL, not the timeout, so the timeout is generous (3 s) by
  default; the freshness/cadence knob is the TTL (30 s).

### 5. Per-verb `timeout` is server-enforced and bounds every surface; it is not pushed to the client

`GET(handler, { timeout: ms })` (any verb), opt-in, no default. `defineVerb`
races the handler against the deadline → `error(504)`. One server-side
enforcement point bounds SSR cache reads, MCP, CLI, **and** the network response
— because the server returning a 504 in time also bounds the browser's wait.

The deliberate non-decision: **the per-verb value is not delivered to the client
fetch.** The server's in-time 504 already bounds the browser for every slow
handler; the only case it can't cover is a server that never responds at all
(unreachable / hung connection), which decision 1's global
`ABIDE_CLIENT_TIMEOUT` already backstops. So neither delivery mechanism was
built:

- **Static bundle-time extraction** into the client stub — literal-only
  (a `{ timeout: SLOW_MS }` constant can't be pulled without risking
  server-code bleed into the browser bundle), which clashes with this
  codebase's pervasive named-constant style.
- **Runtime `__SSR__` map** — verbs register lazily on first use, so a verb not
  yet hit by render time would miss the map; plus a per-page payload.

Outbound cancellation is real, but **network-path only**: when a timed verb is
invoked via `.fetch` (one verb per request), `defineVerb` composes the deadline
into `request().signal` (an `AbortController` joined via `AbortSignal.any`,
shadowed onto the Request with `Object.defineProperty` so the body stays
readable, fired on the deadline). A handler's
`fetch(ext, { signal: request().signal })` is then genuinely cancelled. It is
**not** composed in-process: an SSR pass runs many `cache()` verb calls under one
shared `request().signal`, so aborting it on one verb's deadline would
cross-cancel siblings — there it is race→504 only, and a handler self-bounds its
own outbound I/O.

Accepted limitation: the race *stops awaiting* but cannot cancel a running async
function; the handler's work continues in the background (its late settlement is
swallowed) unless it observes `request().signal`. This is sufficient for the
original backup, because the *inbound* response is sent in time — the browser
pool frees and nav unblocks regardless of the leaked outbound socket.

## Consequences

- Four orthogonal, opt-in knobs, none defaulted: browser wait
  (`ABIDE_CLIENT_TIMEOUT`), caller connectivity (the offline header →
  `online()`), handler deadline (per-verb `timeout`), host reachability
  (`reachable`). A failure on any is an honest status (503 offline, 504
  timeout, the verb's own 404/…), never a flat 500 (decision 3).
- `online()` server-side changed meaning. Code or tests assuming constant
  `true` must account for the calling client's reported state; it is still
  `true` whenever no client reported (SSR, cron, webhook). Documented at the
  source and in its design memory.
- `reachable()` is async and host-granular by design. It will not catch an
  endpoint that is up-but-broken (that is response-status + timeout), and a
  captive portal can false-positive it (same residual `online()` carries) — both
  accepted for a connectivity signal.
- Per-verb `timeout` lives in server opts but is server-inert only in the sense
  that it never reaches the client — it *is* enforced on every surface that runs
  the handler. A handler that wants its outbound work torn down (not just the
  caller unblocked) must pass `request().signal`; on the network path the verb
  deadline now fires it, in-process it does not.
- Left unbuilt: `.maybe()` on remote functions (demote a chosen not-found
  status to `undefined` — the per-call catch); sub-page error isolation sugar
  (a abide boundary component carrying the same `{ status, message }` contract),
  gated on a Svelte async read-site/boundary spike; per-verb client-fetch
  delivery (only needed to bound the *unreachable* case per-RPC rather than via
  the global). Each is a separate, additive decision.
