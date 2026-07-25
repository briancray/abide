# ADR 0023 — Step 7 conceptual reframe (DRAFT for review)

**Status: proposed, NOT applied — and PARTLY SUPERSEDED. Re-read before applying.** This stages the
*framing-heavy* half of step 7 for review before it touches the primary docs. The *objective* corrections
(now-false statements) already landed in commit `898f0ba6` (CLAUDE.md law line, client-sockets zero-arg
probes, replayable-streams stale build note).

> **What has changed under this draft since it was written** (do not apply §1 or §3 verbatim):
> - The atom is no longer called `signal` — ADR 0023's rename landed and it is **`state`**. Every
>   `signal` below should read `state`.
> - "`channel`'s isomorphic face is the `socket`" is **false**. `channel` moved to `shared/` on a
>   `ChannelHub` and is isomorphic in its own right; `socket` is its authorization+transport shell.
> - **§1 is effectively done.** CLAUDE.md's preamble now states the three-primitive tree and both
>   transport laws, corrected for the two points above. What is still unapplied there is only the
>   *additional* voice-setting prose (fine-grained rendering; "a read is reactive iff it runs inside a
>   watch"), which is what still needs approval.
> - ADR 0024 has since landed: `state.computed`/`state.linked` are gone and derivation is `memo`'s job.
>   Any framing that lists a `state` family needs to reflect that.
> - **§2 (sockets.md `handler` → `clientPublish`) is unaffected** by all of the above and still stands
>   as written.

What remains is additive/voice-setting prose the design conversation earned but that you should approve:
the CLAUDE.md concept-tree preamble, the `sockets.md` S1 reframe off the retired `handler` model, and an
rpc-core tree note. Each is CURRENT → PROPOSED with rationale. Ground truth = the ADR "Landing" section
(Shipped/Design/Refuted) + code (`socket.ts` "A socket IS a channel + transport"). No refuted concepts
(pipe/node-edge) reintroduced; no commitment on the bench-gated-last `.signal()`/`.peek()` collapse.

---

## 1. CLAUDE.md preamble — "Core model" (lines 31–34)

**CURRENT** (memo-monist — frames `memo` as *the* primitive; silent on the tree + second law):

> Core model: the primitive is **`memo`** — a generic isomorphic memoizer for async functions (cache +
> coalesce + reactive read surface); RPC is `memo` + transport. RPC inputs/outputs are **JSON-serializable
> only**; the rich value codec applies only to hydrated non-RPC values.

**PROPOSED:**

> Core model: one reactive atom, **`signal`**, underlies three primitives — **`state`** (own — a writable
> cell), **`memo`** (load — a generic async memoizer: cache + coalesce + reactive read surface, lazy/pull),
> **`channel`** (subscribe — a pub/sub stream) — plus **`watch`**, the one eager effect. (`state`/`memo`/
> `watch` are isomorphic — same import, call, both sides; `channel`'s isomorphic face is the `socket`.) Two
> transport laws follow the pull/push split: **`rpc = memo + transport`** and **`socket = channel +
> transport`** (an in-proc call bypasses transport and hits the primitive directly). Rendering is
> fine-grained — one `watch`/effect per template binding, no VDOM; a read is reactive iff it runs inside a
> watch. RPC inputs/outputs are **JSON-serializable only**; the rich value codec applies only to hydrated
> non-RPC values.

Rationale: states the concept tree and both laws (the load-bearing correction), plus the two durable
"Shipped" facts (memo lazy; render = per-binding watch). Terse, matches house style.

---

## 2. sockets.md — through-line + S1 (retired `handler` model → `clientPublish` mediator)

The `handler` option was removed (commit `69458b83`) and replaced by `clientPublish: false | true | fn`;
CLAUDE.md + `socket.ts` are the authoritative shape. The spec still documents the dead API.

### 2a. Through-line (lines 8–10)

**CURRENT:**

> Through-line: a socket is a **named, typed, persistent pub/sub topic** — the only one of abide's three
> async modes (RPC / stream-read / socket) that is *named, publishable, and replayable*. Declarative by
> default (validated pass-through relay); server logic is opt-in.

**PROPOSED:**

> Through-line: a socket is a **`channel` + transport** (ADR 0023) — the `channel` primitive (named, typed,
> persistent, replayable pub/sub) carried across the WS transport with the **same surface on both sides**.
> It is the push/subscribe peer of `rpc = memo + transport`. Client publish is **opt-in and mediated**
> (`clientPublish`); a non-void `Args` gives **per-room** isolation.

### 2b. S1.3 "Publish authority" — replace the A/B handler bullets (lines 32–40)

**CURRENT** (bullets):

> - **Client publish is opt-in via `clientPublish` (default false).** When on, client messages are
>   **untrusted**: `schema`-validated on arrival and gated by connect-time auth (S4 middleware).
> - **No handler → validated pass-through relay (A, default):** a client publish fans out to all
>   subscribers. Covers chat/cursors/presence.
> - **Handler present → server-mediated (B, opt-in):** each client publish is delivered (post-validation)
>   to the handler, which runs **in connection scope** (knows the sender) and may **transform-and-publish**,
>   **reject** (throw → error to publisher), or **drop**. Pass-through is the degenerate handler
>   `msg => publish(msg)`.

**PROPOSED:**

> - **Client publish is opt-in and mediated via `clientPublish` = `false | true | fn` (default `false`).**
>   Client messages are **untrusted**: `schema`-validated on arrival and gated by connect-time auth (S4).
>   - **`false`/omitted** — clients may not publish.
>   - **`true`** — unmediated pass-through: a client publish fans out to all subscribers (chat/cursors/
>     presence).
>   - **a function `(msg) => T | void | DROP`** — mediated: it **transforms** the untrusted message (or
>     returns `DROP` — or nothing/`void` — to suppress), runs server-side (it may read ambient
>     `identity()`/`request()` where the transport has established them), and may **reject** (throw → error
>     to publisher). The mediator fn **is** the permission — a mediator on a closed publish path is
>     unrepresentable, and a server `publish` always **bypasses** it.

### 2c. S1.4 (lines 41–44)

**CURRENT:** "**The handler is content-mediation only, NOT an auth mechanism.** … The handler exists solely
to act on message *contents* …"

**PROPOSED:** "**The `clientPublish` mediator is content-mediation only, NOT an auth mechanism.**
Authorization is connect-time middleware (+ per-room `middleware` for a roomed `Args` socket, ADR 0023);
`clientPublish` + `schema` gate *whether* and *what*. The mediator exists solely to act on message
*contents* (enrich, persist, content-based reject, computed fanout) — which connect-time hooks cannot,
since the message doesn't exist yet."

### 2d. Mechanical `handler` → `clientPublish` mediator replacements (same-meaning, no A/B model)

- Line 74 "POST → publish … (runs `schema` + handler + auth …)" → "… `schema` + `clientPublish` mediator +
  auth …".
- Line 107 WS table cell "publish → handler" → "publish → `clientPublish` mediator".
- Line 111 "the handler gates *content*" → "the `clientPublish` mediator gates *content*".
- Line 115 options "`{ tail, ttl, clientPublish, schema, clients, handler? }`" → "`{ tail, ttl,
  clientPublish, schema, clients, middleware? }`" (drop `handler`; add per-room `middleware`).
- **Line 126 is LEFT UNCHANGED.** Its "handler" ("global-wraps-per-RPC-wraps-handler, FD1") is the
  middleware onion's terminal **request** handler, NOT the socket `clientPublish` mediator — renaming it
  would corrupt the sentence. (Caught in adversarial verification; do not touch.)

### 2e. S1.1 three-way taxonomy (lines 16–21)

Keep the RPC / streaming-read / socket taxonomy (still a useful distinction), but retitle its framing to
connect to the primitive: a socket is the **channel-over-transport** mode — the named + publishable +
replayable one. (Minor edit; no bullet content change.)

---

## 3. rpc-core.md — intro tree note (memo-monist → three-primitive tree)

rpc-core.md correctly says `rpc = memo + transport` but frames memo as the *sole* primitive. Add one
sentence after its opening: "`memo` is one of three isomorphic primitives over the `signal` atom —
`state` (own), `memo` (load), `channel` (subscribe); the peer law is **`socket = channel + transport`**
(see `sockets.md`, ADR 0023)." No other change; rpc-core's RPC content stands.

---

## Apply plan (on approval)

1. CLAUDE.md preamble swap (§1).
2. sockets.md §2a–2e edits.
3. rpc-core.md one-sentence insert (§3).
4. Verify-gated (`bun test` + typecheck + biome; markdown-only, so zero runtime risk — the gate is
   discipline, not enforcement). Commit as `docs(adr 0023 step 7): concept-tree reframe`.
5. Retire this DRAFT file.
