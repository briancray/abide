# abide — Sockets (Spec, Slice 3)

Status: draft, derived from design interview 2026-07-17.
Scope: the `socket(...)` pub/sub primitive, its transport, and the `app.ts` hook-context
shape it forces. Builds on `docs/spec/rpc-core.md` (§refs) and `docs/spec/abide-compiler.md`
(C-refs). Sockets are the transport for §8 live invalidation broadcast.

Through-line: a socket is a **named, typed, persistent pub/sub topic** — the only one of
abide's three async modes (RPC / stream-read / socket) that is *named, publishable, and
replayable*. Declarative by default (validated pass-through relay); server logic is opt-in.

---

## S1. Model & publish authority

1. **Three-way async taxonomy:**
   - **RPC** (`GET`/`POST`) — request/response.
   - **Streaming read** (§12, `jsonl`/`sse`) — one-shot server→client subscription, **no
     replay**.
   - **Socket** — a **named, typed, bidirectional topic**; multiple parties publish/
     subscribe; **replayable** (S2). The only *named + publishable + replayable* mode.
2. **Isomorphic `Socket<T>` = `AsyncIterable<T>`.** Consume identically on both sides:
   `for await (const msg of chat) { … }`. Subscribe = iterate; unsubscribe = break /
   scope-dispose (§12.5 `AbortSignal` lifecycle). One `socket(...)` per file in
   `src/server/sockets/<name>.ts`.
3. **Publish authority:**
   - **Publish is `socket.publish(msg)`** — the same call on both sides. Server code always
     may call it (server→all subscribers, fanned out per client WS); on the client it exists
     **only when `clientPublish` is on**.
   - **Server code always may publish** (server→all subscribers, fanned out per client WS).
     This is the §8 broadcast path and the "RPC-that-publishes" pattern.
   - **Client publish is opt-in via `clientPublish` (default false).** When on, client
     messages are **untrusted**: `schema`-validated on arrival and gated by connect-time
     auth (S4 middleware).
   - **No handler → validated pass-through relay (A, default):** a client publish fans out
     to all subscribers. Covers chat/cursors/presence.
   - **Handler present → server-mediated (B, opt-in):** each client publish is delivered
     (post-validation) to the handler, which runs **in connection scope** (knows the sender)
     and may **transform-and-publish**, **reject** (throw → error to publisher), or **drop**.
     Pass-through is the degenerate handler `msg => publish(msg)`.
4. **The handler is content-mediation only, NOT an auth mechanism.** Authorization lives at
   connect-time (middleware chain) + `clientPublish` + `schema`. The handler exists solely to act
   on message *contents* (enrich, persist, content-based reject, computed fanout) — which
   connect-time hooks cannot do because the message doesn't exist yet.

## S2. Replay, retention, ordering, delivery

1. **`tail: N` = last-N replay buffer** delivered to a new/reconnecting subscriber before
   live messages. **Default `tail: 0`** (live-only, like §12). Per-socket ring buffer.
2. **`ttl: <ms>` = tail message age bound** — a buffered message older than `ttl` is dropped
   and not replayed. **Default `ttl: ∞`** (consistent with §3). A message is replayable only
   within *both* `tail` (count) and `ttl` (age). This `ttl` is buffer retention, **not** the
   connection idle timeout (`ABIDE_SOCKET_TIMEOUT`).
3. **Ordering: per-socket FIFO by server-arrival.** The server is the serialization point;
   all subscribers observe messages in accept order (client publishes ordered by arrival,
   not send-time).
4. **Delivery: at-most-once, best-effort** (matches §8). No per-subscriber durable queue, no
   acks, no redelivery. A subscriber offline at send time gets a message *only if* it
   reconnects within the `tail`/`ttl` window.
5. **No cursor/offset protocol.** Reconnect gets the current tail (may re-see or miss);
   `tail`/`ttl` is fuzzy resync, not a durable log.

## S3. Transport, HTTP face, scaling

1. **One multiplexed WebSocket per client** (`/__abide/sockets`); all sockets share it,
   framed by name (not a separate connection). **§8 cache-coherence broadcasts
   (`amend`/`invalidate`/`refresh`) ride authorized `(rpc, args)` channels on this same
   mux** (e.g. `profile:A`), **not** a single global-fanout socket: a client receives a
   channel only if it has **joined** it, and joining a channel **requires authorization to
   read that slot** (you can't join `profile:B`'s channel unless allowed to read
   `profile(B)`). The dev-reload channel (BP2.3) is a separate reserved internal channel.
2. **Per-socket HTTP face (`/__abide/sockets/<name>`) = the WS-less path:**
   - **GET → subscribe over SSE** (for non-WS environments, `curl`, CLI, MCP).
   - **POST → publish** one message (runs `schema` + handler + auth, same as a WS publish).
3. **Single-process core; backplane parked.** Tail buffer + fanout live in **one server
   process**. Behind a load balancer with N instances, a subscriber on instance A won't see
   a publish on instance B **without a backplane** (Redis pub/sub / equivalent). Core =
   single-process; horizontal fanout is a later **adapter at a defined seam**. Documented
   **loudly** — cross-instance cache-coherence gaps are a **correctness** caveat (not just
   lost realtime): it silently breaks §8 invalidation coherence and cross-instance chat.
4. **Backpressure: bounded per-subscriber outbound buffer; shed laggards.** On overflow,
   drop oldest (at-most-once, S2.4) or disconnect the slow consumer — never buffer
   unbounded.

## S4. Multi-client exposure, schema, auth

1. **`clients: { browser, mcp, cli }` (same semantics as §13** — default-on all three,
   `false` = not exposed to that surface, uniform auth):
   - **Browser** → the isomorphic `Socket<T>` over the WS mux (default).
   - **CLI** → a streaming subcommand via the HTTP face: subscribe → stdout SSE stream;
     publish → a POST command. Fully defined.
   - **MCP** → **subscribe maps to a "tail" tool** (snapshot-poll baseline, streaming on
     capable transports); **publish (if `clientPublish`) maps to a publish tool**. This is a
     tool mapping, **not** an MCP resource-subscription, and aligns with machine-surfaces
     MS2.2.
2. **`schema` validation direction (mirrors §10.3):** client→server publishes validated
   **always** (untrusted); server→client (outbound) validated **dev-on / prod-off**.
3. **Type-derived message schema (mirrors §11):** with no explicit `schema`, derive the
   message JSON Schema from `socket<T>()`'s `T` — feeds validation + CLI/MCP generation,
   loud-on-unrepresentable.
4. **Auth uniformity, two enforcement mechanisms by transport:**

   | Transport | Middleware runs | Per-op authz |
   | --- | --- | --- |
   | WebSocket | once, at `socket-connect` (the upgrade) | in-connection: publish → handler; subscribe → connect-auth |
   | HTTP face (SSE/POST) | **per request** (`socket-subscribe` / `socket-publish`) | the per-request middleware chain |

   - **No `canPublish` predicate** — connect auth gates *who*, `clientPublish` gates *on/off*,
     the handler gates *content*. Three levers, no fourth.
   - **`canSubscribe` PARKED** — default subscribe authz = connect-time auth + exposure
     toggle; per-socket subscribe gating (`admin-feed` vs `public-feed`) is a documented
     future predicate.
   - **Socket API surface: `{ tail, ttl, clientPublish, schema, clients, handler?, crossOrigin? }`.**
     `crossOrigin` (default closed, allowlist opt-in) is the cross-origin socket-access gate
     that auth.md AU8-CSWSH relies on.

## S5. Middleware & request discrimination (forced by socket auth)

Auth (including socket connect-auth) runs in **onion middleware** — the same
`(next) => Response` array for `app.ts` globals (`export const middleware = [...]`) and
per-RPC (`{ middleware: [...] }`), composed global-wraps-per-RPC-wraps-handler (FD1).
Middleware runs on every server-touching request except static assets (C6-nav) and must let a
guard discriminate request kind **without parsing internal paths** (paths are an escape hatch,
not the discriminator).

- **Middleware signature:** `async middleware(next) { … return await next() }`. `next()` takes
  **no args** (request via `request()`); short-circuit by returning a `Response`
  (`error(...)` / `redirect(...)`). **Auth is just middleware** — a guard is a middleware that
  returns `error(403)` instead of calling `next`; there is no separate `auth:` property and no
  `ctx` object.
- **Request kind/name/params come from the isomorphic `route()`** → `{ kind, name, params,
  url, navigating }` (FD2), derived from the request URL and available in middleware and
  templates alike (`page` is retired). `identity()` and `request()` are ambient accessors.
- **`route().kind` is a discriminated union** the framework populates from routing:
  - `'nav'` — page navigation; `name`/`params` = route + params.
  - `'rpc'` — RPC call; `name` = rpc name, `params` = the args object.
  - `'socket-connect'` — WS upgrade to the mux (no specific socket named yet).
  - `'socket-subscribe'` / `'socket-publish'` — HTTP-face ops; `name` = socket name.
  - `'stream'` — §12 streaming read (if distinguished).
- **A middleware can observe (log/trace) and decide (allow / `redirect` / `error`)** (C6-nav.2).
- **WS runs middleware only at `socket-connect`.** In-connection subscribe/publish do **not**
  re-enter the middleware chain (no per-message HTTP request); authorized in-connection.
  - **Exception — `@rpc:` cache-invalidation channels (rpc-core §8.4 / shared-cache-plan §2.3).**
    Joining a `@rpc:<rpc>:<key>` cache channel re-runs THAT rpc's read gate (`compose(global,
    rpc.middleware)`) with the connection's identity and the subscribe frame's raw `args`, **per
    subscribe** — because middleware may enforce per-args row-level authz (joining `profile:B`
    must pass `profile`'s chain for `{id:B}`). Bare user-socket subscribes stay connect-authed.
- Raw path remains available via `request()` for escape-hatch cases; discrimination is via
  typed `route().kind`, stable against internal path changes.

---

## Deferred / parked (rule before implementation)

- **`canSubscribe` predicate** (per-socket subscribe gating finer than connect-auth) — S4.
- **Horizontal backplane** (Redis-style cross-instance fanout) — S3.3; the seam is defined,
  the adapter is not.
- **Presence / who's-connected**, exactly-once cursors, durable per-subscriber queues,
  message acks/redelivery — explicitly out of the best-effort core.
- **Auth *mechanism* itself** (how connect-time identity is established — cookie session /
  bearer `ABIDE_APP_TOKEN` / `appDataDir`) — still parked across all three specs; S4 only
  fixes that authz is uniform and where it's enforced.
