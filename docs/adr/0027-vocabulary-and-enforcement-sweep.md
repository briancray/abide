# ADR 0027 — the enforcement sweep: rules mechanized to the leaf

**Status:** accepted; **all ten decisions BUILT 2026-07-26**. Supersedes naming rows in ADR 0023
(§2 "the two verbs"), ADR 0024 (`memo({ shared })`), and completes ADR 0026 (the unaudited layer edge).

Each decision carries a **LANDED** note recording what implementation changed about it — three did.
Two are worth reading before the rest, because they are corrections to this document rather than
confirmations of it:

- **D4's `channel.pending` half was RETRACTED at implementation.** It was wrong on three counts, and
  the docs app settled it. The composition half stands.
- **D9 grew.** Typing `clients` exposed a second dead behaviour in the same normalizer — `clients:
  false` meant the *opposite* of what it documented — which is a sharper instance of this ADR's thesis
  than the one D9 was written for.

Also worth noting for calibration: **D6 needed no code at all** beyond a deletion (the router already
derived `HEAD`), and **D10 could not be done as written** (moving `Rpc` to `shared/` would have dragged
middleware and CORS into the bottom layer; the fix was a type split along a seam that already existed).

## Context

A root-to-leaf audit of the concept tree found **no bad decisions** across nine branches. Every ADR
holds up under adversarial reading. What it found nine times was one failure mode:

> A rule is stated at the root and enforced one layer short of the leaves.

| rule | stated in | mechanized to |
|---|---|---|
| `socket = channel + transport` | ADR 0023 | `server/socket.ts` reaches through `__hub` and re-derives the surface |
| one `ReactiveReadSurface` | ADR 0023 §1 | four probe constants hardcoded twice |
| `peek` means one thing | implied everywhere | two meanings, declared 8 lines apart in one string literal |
| one-way layering | ADR 0026 | 4 of 6 edges audited; the broken one was not among them |
| the `Room` positional | ADR 0023 §2 | correct — but written as a list of two, not a law |
| `clients` = reachability, **not** authorization | `CLAUDE.md` (bolded twice) | option typed `unknown`; a documented sub-option is unimplemented |

The pattern matters more than any single fix: the design language is sound, and the gap is
*mechanization*. Where a rule was expressed as a type, an override, or a delegation, it held. Where
it was expressed as prose or as an enumeration, it drifted.

## Decisions

### D1 — Always nest primitive options in a transported form

```ts
socket({ channel: ChannelOptions, clientPublish, middleware, schema, clients })
```

The nested value is the channel's own exported options type, so `maxAge` arrives by construction.

**Why.** `socket` flattened `tail`/`ttl` to the top level, which gave up the namespace, which is why
`socket({ ttl })` collided with `memo({ ttl })` — two different concepts (per-message age window vs
per-slot retained-value window) under one word, one layer apart. `channel` had already renamed its own
to `maxAge` (`shared/channel.ts:30`) and `socket` translated back (`server/socket.ts:93`). Nesting
removes the translation rather than renaming it.

**Cost of flattening, stated once:** a flattened option name must be globally unique across the
framework. Nesting is cheaper than maintaining that invariant.

- **Code:** `server/socket.ts:28-40`; delete `:88-93`
- **Docs:** `CLAUDE.md` socket row · `docs/spec/sockets.md` · `docs/spec/client-sockets.md` · docs-app
- **Breaking:** public

### D2 — `peek` is the reactive non-blocking read, framework-wide

`state.peek()` → `state.untracked()`. `Computed.peek()` likewise.

**Why.** `peek` is the only verb on all three primitives, and it is inverted on the tracking axis —
the axis the whole reactive model is built on:

| | subscribes? | side effect | returns |
|---|---|---|---|
| `state.peek()` (`reactive.ts:283`) | **no** — reads `node.value`, never `get()` | none | `T` |
| `memo.peek(args)` (`memo.ts:882`) | **yes** | kicks a coalesced load | `T \| undefined` |

The collision at its most concentrated, in one string literal:

```
ui/internal/emitCheck.ts:52   interface __AbideState<__T> { (): __T; set(v: __T): void; peek(): __T; }
ui/internal/emitCheck.ts:60   interface __AbideMemo<__T>  { (): __T; peek(): __T | undefined; … }
```

And made flesh in `memo.state()`, which manufactures one from the other:

```js
cell.peek = () => untrack(() => c.peek(args)) as T   // state-peek := untrack(memo-peek)
```

**Direction of the rename.** Toward `state`, for three reasons: `memo.peek` is the load-bearing
public verb (template grammar, RPC surface, socket surface, `ReactiveReadSurface`) while
`state.peek` is nearly invisible to authors (the compiler rewrites bare reads); the unifying axis
should win; and `state.peek()` is exactly `untrack(() => cell())`, i.e. a second spelling of an
operation already exported at `reactive.ts:368`.

- **Code:** `shared/internal/reactive.ts:263-267, :283, :291` · `shared/state.ts:46, :92, :114` ·
  `emitCheck.ts:52` · internal `slot.state.peek()` call sites in `memo.ts`
  (`:547, :574, :723, :743, :767, :783, :790, :866, :930, :983, :1012`)
- **Docs:** docs-app `pages/state/page.abide:28`, `pages/memo/page.abide:63`; `CLAUDE.md` documents
  `memo.peek` in three places and `state.peek` in none — add the distinction
- ⚠️ The cell shape lives in four places (`state.ts`, the emit target, `emitCheck`'s `__AbideState`,
  the test fixtures). Missing the last two presents as a "not a function" framework bug.

**LANDED 2026-07-26.** `State.untracked()` / `Computed.untracked()`; 37 call sites patched, plus the two
places no type checker could reach.

**Method worth recording:** the rename was driven BY the type checker rather than by find-replace.
Renaming the interface member first turned every `State`/`Computed` `.peek()` into a `TS2339`, while
`memo`/`socket`/`channel` `.peek()` stayed valid — so `tsc` enumerated exactly the sites to change and
proved, by staying silent on the rest, that the two meanings had been correctly separated. A textual
`.peek(` sweep would have hit all 67 occurrences indiscriminately.

**The two it could not see** are the ones the ⚠️ predicted, and both failed loudly at runtime rather than
at compile time:
1. `cli/check.test.ts`'s `CELL_MODULE` — a fixture that hand-writes a fake `abide/shared/state`
   (`interface Cell<T> { …; peek(): T }`). It is matched STRUCTURALLY by `emitCheck`'s `__abideUnwrap`
   overload, so the stale member silently stopped the unwrap from resolving and every bare cell read
   started reporting as `Cell<T>` instead of `T` — 37 spurious diagnostics in one test.
2. `sharedCache.test.ts`'s `(entry as { state: { peek(): … } })` — a structural *assertion*, invisible to
   `tsc` by construction, which failed at runtime with "peek is not a function".

The emit byte-parity oracle is UNCHANGED (178 snapshots), which is the gate that matters here: the
compiler emits `()` / `.set()` for a cell and never `.peek()`, so no renamed identifier reached emitted
output. Verified the emitters contain no `peek` at all beyond the unrelated `peekSettled`.

Two nice confirmations in the docs app: `serverReactiveRead.ts` had `total.peek()` and `doubled.peek()`
on ONE line meaning different things (state → untracked, memo → reactive probe); they now read
differently. And `SocketsChatDemo`/`PeekDemo` needed no change at all, because a socket's `peek` was
always the reactive one.

### D3 — Bare `{fn(args)}` stays a check error, restated as a boundary

`await` = blocking · `peek` = non-blocking · auto-await = passthrough backstop for `T | Promise<T>`.

**Why not make the bare call the non-blocking read** (the tempting unification): on the server it is
the *blocking* one. `ui/internal/emitServer.ts:253` emits every text slot as
`renderValue(await (expr))` — unconditionally, and it must, because the emitter is type-blind: it
cannot distinguish a promise-returning memo call from a plain value from the `T | Promise<T>` union
that is deliberately legal. Making the bare call mean "snapshot" would require the AOT emitter to
carry type information.

**The decisive argument is the project goal**, not the emitter: *isomorphism by default — same
callable, same name, same intent on both sides.* The primitives are usable in a plain `.ts`, where
there is no compiler, so `fn(args)` is a `Promise<T>` and the non-blocking read has exactly one
spelling: `peek`. A `.abide`-only meaning would make one expression mean two things by file
extension.

- **Code:** delete the pending-decision note at `ui/internal/runtime.ts:487`
  (*"until the bare-read SSR semantics change"* — now decided)
- **Docs:** `CLAUDE.md` async-reads table. The diagnostic at `emitCheck.ts:68` is already correct.

**LANDED 2026-07-26.** Documentation only, as scoped — no behaviour changed. The parked note at
`runtime.ts` now records the decision instead of deferring it, and `emitCheck`'s `textExpr` comment
leads with the boundary (three forms, three behaviours) rather than with the type-system symptom.

### D4 — Earn the shared surface

`server/socket.ts` composes `channel` instead of re-deriving it.

**Why.** `socket = channel + transport` is not true in code today. `server/socket.ts:115-118`
re-hardcodes the same four constants `shared/channel.ts:87-90` already defines, and `:110/:112` reach
through `ch.__hub(...)` rather than calling `ch.peek` / `ch.chunks`. Duplicated degenerate probes are
how you can tell a composition law is aspirational.

~~Additionally: **`channel.pending` is the one genuine lie** and must be derived
(`tailSnapshot() === undefined`).~~ **RETRACTED at implementation — this half of D4 was wrong.**

Three things killed it, in ascending order of importance:

1. The sketch does not compile against reality: `ChannelHub.tailSnapshot()` returns `T[]`, never
   `undefined`, and `tail` defaults to **0**, so the derivation would report `pending` forever on
   every default channel. (`peekLatest()` would have been the right basis — `last` is retained
   independent of tail size, `channelHub.ts:31-33`.)
2. It contradicts this decision's own third paragraph. If probe liveness follows the TRANSPORT, then
   an in-proc topic with no transport cannot be pending, and `false` is not a lie but the answer.
3. The docs app settles it: `demos/sockets/SocketsChatDemo.abide:19` reads
   `socketsChat.pending() ? "connecting" : "live"`. Deriving `pending` from "has a message arrived"
   would report **"connecting" on an idle but fully-connected socket** — strictly worse than today,
   and wrong in exactly the way the surface contract ("first acquisition in flight") forbids.

The error was conflating *no value* with *pending*. An empty channel is not pending, it is **empty** —
`peek() → undefined` with `pending() → false` is the honest report of a live topic nobody has
published to, and a consumer spells the placeholder itself (`{ch.peek() ?? "no messages yet"}`), the
same way `CLAUDE.md` already tells them to for a cold memo. All four constants stand.

What survives is the part that was verified against code: **socket must compose channel, not
re-derive it.**

**Probe liveness is a transport property, not a storage property.** `pending` means "the transport has
not yet delivered": in-proc is instantaneous, so `false` is correct server-side; WS can be pending, so
`ui/internal/socketProxy.ts:185-188` is correct client-side. This makes the side-divergence a
consequence of the model rather than an inconsistency.

- **Code:** `server/socket.ts:110-118` · `shared/channel.ts:87`
- **Docs:** `CLAUDE.md` "identical surface on both sides" → "identical surface; probe liveness follows
  the transport"

**LANDED 2026-07-26 (with D1).** Every probe/verb on `server/socket.ts` now delegates to the channel —
`publish` → `ch.publish`, `peek` → `ch.peek`, `chunks` → `ch.chunks`, and the four status probes →
their channel counterparts. The duplicated constants are gone; `__hub` survives only inside
`__socket`, where it is the genuine transport hook (replay-controlled subscribe / tail snapshot for
the mux). Gates: typecheck clean, 1303 pass / 0 fail.

**A typing wart the delegation exposed.** `ReactiveReadSurface.chunks` returns `unknown[] | undefined`,
so delegating cost `socket.chunks` its element type. That signature is correct for a MEMO — a
`StreamRead<Args, C>` yields `C`s while `T` is the value, so the surface cannot promise `T[]` — but a
channel's transcript IS its messages. `Channel<T, Args>` now narrows it to `T[] | undefined`, which is
a legal covariant override and means a delegating caller never re-asserts. Worth noting as evidence
for the ADR's thesis: the duplicated implementation had been silently *papering over* a weakness in the
shared interface, and composing is what surfaced it.

### D5 — `memo({ shared })` → `memo({ crossRequest })`

`state.shared` keeps its name.

**Why.** The two `shared`s are exact mirror images on the isomorphism axis:

| | `state.shared(key, initial)` | `memo({ shared })` |
|---|---|---|
| client | **real** (`state.ts:95-116`) | **inert** (`memo.ts:130`) |
| server | **degraded** to per-render (`state.ts:86-93`) | **real** |
| scope | cross-instance + cross-tab | cross-request |

ADR 0023's own tree resolves the ambiguity in prose — *"server-shared ≈ a shared `memo`"* — which is
only necessary because the word was overloaded. `state.shared` keeps it because a reader guesses that
meaning correctly unaided; the server cache needs a name that says *this escapes the request*.

- **Code:** `shared/memo.ts:130, :422, :428` · `server/internal/makeRpc.ts` (RPC `memo:` opts) ·
  `clientProxy.ts` · `registry.ts`
- **Docs:** `CLAUDE.md` ×3 · `docs/spec/rpc-core.md` · `docs/spec/shared-cache-plan.md`
- **Breaking:** public

### D6 — Delete `HEAD`; the router derives it from `GET`

**Why.** `server/HEAD.ts` is `server/GET.ts` with the verb string swapped (modulo one re-export).
HTTP `HEAD` *is* `GET` minus the body — a router responsibility, not an author one. Today an author
can write a `HEAD` handler returning a payload (meaningless over the wire) or register `GET` and
`HEAD` for one resource with divergent bodies. Deriving it makes `HEAD` correct for every read
automatically instead of only where someone declared it, and removes a public export that taught
nothing.

**Rejected:** keeping `HEAD` for the cheap-headers case (return `Content-Length`/`Last-Modified`
without the expensive work). Real, but unused here — and the honest shape for it is an opt-in on the
read (`GET(fn, { head })`), not a parallel constructor. Add it if asked for.

- **Code:** delete `server/HEAD.ts` · `router.ts` · `registry.ts` · `openapi.ts`
- **Breaking:** public

**LANDED 2026-07-26 — and it needed NO router change, which was worth probing before writing one.**
Checked empirically first: a `HEAD` request to a `GET`-declared rpc already returns `200`, the correct
`content-type`, and a **zero-length body**. Two pre-existing reasons — RPC routes key by NAME and the
dispatch gates on `meta.read`, not on the verb, so `HEAD` reaches the handler; and Bun strips the body
for `HEAD` on the way out. `HEAD` was *already* derived. `HEAD.ts` was pure duplication sitting beside
a working derivation, which is the strongest possible form of this ADR's thesis.

The deleted helper's tests are replaced by one that issues a real `HEAD` request and pins the derived
behaviour end-to-end. Worth recording what the old tests asserted: that a second constructor produced
the same `__rpc` metadata as the first. They could never have caught a broken `HEAD` — they never sent
one. `packages/docs`'s `rpcPing` moved to `GET`, and its demo still fetches with `method: "HEAD"`, so
it now demonstrates the derivation rather than a duplicate helper.

### D7 — `memo.state` takes an initial, via the `Room` positional

```ts
state(...args: [...Room<Args>, initial: T]): State<T>   // async — initial required
state(...args: [...Room<Args>]): State<T>               // sync — sound as-is
```

**Why.** `c.state` casts `c.peek(args) as T` twice while `peek` returns `T | undefined`, so a
`State<T>` from a cold memo hands back `undefined` typed as `T`.

**Why not `State<T | undefined>`:** `State<T>` is invariant across read and write
(`reactive.ts:263`), so widening the read widens `set` — and `Memo.publish` takes `next: T`
(`memo.ts:168`), where `undefined` is the *sentinel for cold*. A projection more permissive than what
it projects onto would let a local write forge "not loaded."

**Why sync needs no initial:** a sync memo is never pending (`memo.ts:1053-1057`) and **rethrows** on
error (`:1023`; the async path instead `Promise.reject`s at `:1004`). The read is `T`-or-throw, with
no `undefined` hole. `SyncMemo` (`:227`) and `SyncKeyedMemo` (`:235`) already exist as interfaces
overriding only the call signature; they override `state()` the same way.

**Implementation condition:** the sync projection must read through the throwing path, not `peek` —
otherwise the `as T` lie moves from "cold" to "errored" rather than being removed.

**Consequence — restate the rule as a law.** This makes `state` the *third* trailing-payload verb.
`CLAUDE.md` and ADR 0023 §2 both say "the two verbs with a TRAILING payload," an enumeration that
goes stale on landing. Replace with:

> Every verb with a trailing payload takes the key as a `Room` positional.

With two instances the positional reads like a coincidence accommodated after the fact; with three it
reads like a law.

- **Code:** `shared/memo.ts:175, :227, :235`, the `c.state` impl (drops both casts)

**LANDED 2026-07-26**, with two things the design did not anticipate.

**1. The `Room` positional is ambiguous when the payload is OPTIONAL.** `publish` and `watch` never hit
this because their payload is mandatory: `publish(v)` is argless-with-value, `publish(k, v)` is keyed.
But a sync memo takes no initial, so `m.state(x)` could be a keyed-sync call (x = room) or an
argless-async one (x = initial) — same arity, different meaning. Resolved with `fn.length`, which the
memo already knows: an argless memo has no room, so a lone argument can only be the initial; a keyed one
always names its room first. Worth stating as a caveat on the rule itself — *the `Room` positional is
unambiguous only while the trailing payload is required.*

**2. The generic-safe two-argument overload had to go.** Copying `publish`'s second overload onto `state`
made `SyncMemo`/`SyncKeyedMemo` unable to narrow it (a subtype must satisfy BOTH overloads, and
`(args: void, initial: T)` cannot be satisfied by `(initial?: T)`). It turned out to be unearned anyway:
that overload exists on `publish`/`watch` because the client proxy and the broadcast applier forward an
UNRESOLVED `Args` and cannot spread a deferred conditional tuple — and nothing forwards `state`, which
is only ever called on a memo whose `Args` is concrete. Dropped. `SyncKeyedMemo` narrows via
`state(...args: [...Room<Args>, initial?: T])`, keeping the deferred variadic shape TS requires while
`Args` is still generic.

The stated implementation condition held and mattered: the sync projection reads through the THROWING
path (`hasInitial ? initial : c(slotArgs)`), so an errored sync slot rethrows instead of reading as
`undefined` — otherwise the `as T` lie would have moved from "cold" to "errored" rather than being
removed. Five regression tests pin it, including the arity discrimination and the sync rethrow.

### D8 — Warn on a silent drop to the untracked path (`abide:memo`)

**Why.** Three signals decide whether a memo ever updates on its own, and the two silent ones are the
consequential ones:

| signal | effect | loud? |
|---|---|---|
| `fn.length > 0` | args-keyed instead of auto-tracked | **yes** — throws at `memo.ts:431` |
| body returns a thenable | drops to the classic untracked path (`:679-684`) | **no** |
| `ttl` / `crossRequest` named | drops to the classic untracked path (`:422`) | **no** |

So adding one `await` to an existing memo body silently converts a reactive derivation into a
manually-invalidated cache. The classification happens by *running the body and inspecting the
return*, so it is not statically visible either.

The underlying choice — ADR 0024 §2, *"half-tracked is worse than untracked"* — is correct and stands.
What is wrong is that the choice is made silently on the highest-stakes axis, while the *less*
consequential misclassification got the loud guard. A warning, not an error: both paths are legal and
useful, and the escape hatch already exists (`memo(() => ({a, b}), async ({a, b}) => …)`, ADR 0025) —
it is just undiscoverable if you never learn you lost something.

- **Docs:** `CLAUDE.md` — replace *"Naming `ttl` or `shared` keeps the classic pulled path"* with the
  loss: **a memo can be tracked or retained, not both.**

### D9 — Cut `clients.browser.validate`; type `clients`; warn on unrecognized keys

**Why.** `CLAUDE.md` documents `{ browser: { validate: false | true } }` — *"`true` ships the real
validator client-side for parity."* It is not implemented. `resolveClients`
(`server/internal/registry.ts:61-70`) reads booleans only, so `typeof {…} === 'boolean'` fails, the
key is dropped, and `clients.browser` stays `undefined` — which `:18` treats as *exposed*. The author
configures nothing and is told nothing.

The enabling condition is `RpcOptions.clients?: unknown` (`makeRpc.ts:62`): an untyped public option
plus a silently-lenient normalizer.

**Cut rather than implement.** `clients` is *reachability*; shipping a validator is a *bundling*
decision. If client-side validation parity is wanted it belongs next to `schemas`. Cutting it also
sharpens the boundary `CLAUDE.md` bolds twice — three booleans gating surface **generation**
(OpenAPI omission, MCP tool list, CLI registration) is trivially not authorization, which runs
per-request and can short-circuit. **The split itself holds**; `validate` was smuggling a fourth,
non-reachability concern into it.

- **Code:** type `clients` properly at `makeRpc.ts:62`; `log.warn` on unknown keys in `resolveClients`
- **Docs:** `CLAUDE.md` clients bullet · `docs/spec/machine-surfaces.md`

**LANDED 2026-07-26 — and typing the option exposed a SECOND dead behaviour in the same function,
worse than the one this decision was written for.**

**`clients: false` meant the exact opposite of what it said.** It is documented in `CLAUDE.md` as one
of the three accepted values, but `resolveClients` opened with `if (typeof raw !== 'object' || raw ===
null) return {}` — and `typeof false === 'boolean'`, so the shorthand fell into the *all surfaces on*
branch. An author writing `clients: false` to withhold a callable from every client surface got the
default: **everything exposed.** The function's own comment ("A non-object is treated as 'all surfaces
on'") documented the bug as intent, which is presumably why it survived a `/simplify` sweep.

It is **not** an auth bypass — `clients` is reachability, the raw HTTP endpoint exists either way, and
authorization is `middleware`. But it is a documented control that did nothing, and the failure was
silent in the direction of *more* exposure.

Implemented rather than retracted (unlike `validate`), because it is a documented value with a
coherent meaning — an rpc reachable in-process but advertised on none of the three client surfaces —
and typing the option forces the choice: leaving it unimplemented would mean the new loud path warns
"unrecognized" at a value `CLAUDE.md` tells authors to write.

Landed: `ClientsOption = boolean | Clients` (typed on BOTH `RpcOptions` and `SocketOptions`);
`resolveClients` handles `true`/`false`/object, and warns on `abide:rpc` for a non-boolean flag, an
unknown key, or a non-object non-boolean. Two regression tests in `server/openapi.test.ts` pin
`false` → all three withheld and `true`/absent → all three reachable. Gates: typecheck green in four
packages, 1305 pass / 0 fail.

**Both defects had one cause, and it is this ADR's thesis in miniature:** an `unknown`-typed public
option plus a normalizer that silently discards what it does not recognise. Neither the compiler nor a
dead-field scan can see a shape nobody declared — which is exactly why the other three entries in
`TODO.md` #23 were findable and these two were not.

### D10 — Complete ADR 0026: the unaudited edge

ADR 0026 named the direction (`shared ← ui ← server`) and counted **four of six** edges. The two it
skipped include the one that is violated:

```
             audited by 0026        actual (today)
shared → ui        0                     0   ✓
shared → server    8  ← fixed            0   ✓
ui     → shared   35                    47   ✓ legal
ui     → server    —  not counted        6   ← the violation
server → shared    —  not counted       72   ✓ legal
server → ui        9                     7   ✓ legal
```

`server → ui` is **correct** and stays: SSR is the server rendering UI (`server/internal/pages.ts`),
and the build pipeline is the server invoking the emitter (`clientBundle.ts`).

`ui → server` is the broken edge — **one runtime import and five type-only**:

```
ui/navigate.ts:21          import { matchRoute } from '../server/internal/matchRoute.ts'   ← VALUE
ui/navigate.ts:22-23       import type HydrationSeed, RouteInfo
ui/internal/bootstrap.ts:25    import type HydrationSeed
ui/internal/clientProxy.ts:14  import type Mutation, Rpc
ui/internal/seededState.ts:25  import type HydrationSeed
```

`matchRoute` is pure route matching used by both sides — a `shared/` citizen shipped into the browser
from `server/`, so this is a bundling hazard, not only an aesthetic one.

**Type-only imports are banned too.** They are erased at runtime, but they still make `ui/` unable to
compile without `server/`, and biome's `noRestrictedImports` does not distinguish them — so banning
is the *cheaper* rule; allowing them needs an exception mechanism to maintain. `HydrationSeed` in
particular is the SSR→client handoff contract: a type that is by definition about both sides has no
business in `server/`.

- **Code:** move `matchRoute` → `shared/internal/`; move `HydrationSeed`, `RouteInfo`,
  `Mutation`/`Rpc` → `shared/`; fix the five import sites; add `ui/** ↛ **/server/**` and
  `shared/** ↛ **/ui/**` to `biome.json` overrides
- **Docs:** ADR 0026's edge table — record all six

**LANDED 2026-07-26.** `ui → server` is 0. Gates: 1303 pass / 0 fail (unchanged from baseline),
typecheck green in all four packages, biome at its 4-warning baseline with no new errors, and **both
new rules verified to FIRE** against a deliberate violation rather than merely passing — the
`ui → server` probe was an `import type`, confirming the ban covers the case it was chosen for.

**One correction to this decision's own plan.** "Move `Mutation`/`Rpc` to `shared/`" was not
possible as written: `Rpc` carries `__rpc: RpcMeta`, which reaches `RpcOptions` → middleware, CORS,
and schemas. Moving it would have dragged the whole server option surface into the bottom layer —
trading a layering violation for a worse one.

The honest fix was a **type split along a seam that already existed**. `ui/internal/clientProxy.ts`
implements every member of `Rpc` faithfully — including a deliberately-inert `bindBroadcast`
("server-only seam; inert on the client proxy") — and has no `__rpc`, which is why it needed a cast
to claim the type. So:

- `shared/internal/rpcSurface.ts` — `RpcCallSurface<Args, T>` / `MutationCallSurface<Args, T>`
  (+ `RpcCallArgs`, `MutationCallArgs`), the isomorphic call surface both sides really implement.
- `server/internal/makeRpc.ts` — `Rpc<Args, T> extends RpcCallSurface<Args, T>` adding the one
  server-only member, `readonly __rpc`. Public `Rpc` is structurally unchanged; this is a pure
  refactor, not an API change. *(Since amended: the per-read middleware chain added two more
  server-only members, `bindChain` and `bare`. The seam this decision draws — everything in
  `RpcCallSurface` is isomorphic, the server-only members sit above it — is unchanged and is what
  made room for them; the count is not "one" any more.)*
- `clientProxy` now returns `RpcCallSurface | MutationCallSurface` and the cast stops being a lie.

This is the type-level statement of CLAUDE.md's "isometric RPC consumption" section, which described
the shared call surface in prose while the types had no name for it — the same
stated-but-not-mechanized pattern this ADR is about, found while fixing another instance of it.

## Landing order

Three couplings:

1. **D2 + D7 together** — both rewrite `c.state`; D2 removes the `untrack` wrapper, D7 removes the
   `as T` casts. Separately means touching those four lines twice.
2. **D5 + D8 together** — both touch `memo.ts:422/428`.
3. **D10 first** for a clean base — mechanical, the only one with a runtime bundling hazard, and its
   biome rules then catch regressions from everything after.

Then D1, D4, D6, D9 independently. D3 is documentation only.

## Verification

- `cd packages/abide && bun test` — from the package cwd, never the repo root (the cwd-relative
  happy-dom preload is skipped otherwise).
- `bun run e2e:ci` against `packages/docs` for anything touching D2 or D7 — emitter/runtime
  regressions in that class are exactly what `bun test` misses.
- Do not overlap test runs; a second concurrent suite fakes regressions.

## What this ADR does not change

No decision from ADR 0023, 0024, 0025, or 0026 is reversed. The three-primitive model
(`state`/`memo`/`channel` = own/load/subscribe), the two transport laws (`rpc = memo + transport`,
`socket = channel + transport`), the `Room` positional, "half-tracked is worse than untracked", and
one-way layering all stand as written. This ADR mechanizes them.
