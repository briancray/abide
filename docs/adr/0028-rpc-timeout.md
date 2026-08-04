# ADR 0028 — `rpc.timeout`: the bilateral deadline, actually built

**Status:** accepted; **BUILT 2026-07-27**. Every decision landed as written. Three things the design
did not anticipate are recorded in **Landed** at the end — one of them a whole-stream break that the
unit suite could not see.

Completes a row ADR 0027 opened. D9 found `clients` typed `unknown` with two documented behaviours
rotted underneath it, and named the failure: *a rule stated at the root and enforced one layer short
of the leaves*. `timeout` is the same rot one option over — with an aggravating factor D9 did not
have.

## Context

`RpcOptions.timeout?: number` exists (`server/internal/makeRpc.ts:79`) under a header comment that
says the option is *"carried untouched for the router to enforce"* (`makeRpc.ts:9`). The router never
reads it. `ABIDE_RPC_TIMEOUT` — documented in `CLAUDE.md`'s env table and in `rpc-core.md` §4 —
appears **zero times** in `packages/abide/src`. For calibration, its neighbour in the same options
object, `maxBodySize`, is enforced twice (`router.ts:816-835`).

The aggravating factor: **three modules already depend on the deadline as an invariant.**

| site | the claim |
|---|---|
| `streamScheduler.ts:224` | *"an abide RPC source (`attachable`) is bounded by its own bilateral RPC timeout — which already self-terminates the stream — so it gets NO global SSR cap"* |
| `streamScheduler.ts:328` | the code, not just the comment: `attachable ? await step : Promise.race([step, scope.budget()])` |
| `renderState.ts:36` | *"An abide RPC source is bounded by its own bilateral timeout and NEVER calls this"* |
| `requestScope.ts:128` | `RETAIN_WARN_MS` is calibrated on *"a long-poll `{#for await}` is bounded by its RPC timeout, not by this"* |

So today an abide-RPC `{#for await}` in SSR has **no bound at all** — the global
`ABIDE_SSR_STREAM_BUDGET` is *deliberately skipped* for it, on the strength of a feature that was
never written. The suite is green. That is the shape of the failure: not a wrong decision, an
unmechanized one, load-bearing while absent.

## Decisions

### D1 — `timeout` is the maximum time without PROGRESS

An RPC has four shapes (value read, value mutation, streaming read, streaming mutation). Total
wall-clock is right for a value and wrong for a stream — a token-streaming agent RPC legitimately
runs for hours, and that is the exact case `streamScheduler` delegates to this option.

Rather than give one word two meanings switched by what the handler returned, `timeout` measures
**time since the last progress event**, where progress is defined per shape:

- **value** — the only progress event is settling, so idle-since-dispatch *is* total wall-clock;
- **stream** — time-to-first-chunk, then the inter-chunk gap; the clock re-arms on every chunk.

One sentence, both shapes, no branch on return type. The alternative was rejected for the reason
ADR 0027 D3 rejected making a bare `{fn(args)}` mean "non-blocking": an expression that means two
things depending on context is a concept boundary violation, not a convenience.

**Consequence accepted:** a stream that dribbles one chunk every `T - 1ms` never trips. No second
total-duration bound is added for it. Every abide stream's producer is the app's own handler (SSR:
in-proc; browser: its own server; a `crossOrigin` third party is a *consumer*, not a producer), so a
dribble is your own code misbehaving, and the hole `rpc-core.md` §4 actually names is a *hang* —
which progress-semantics closes completely. A framework-wide knob whose only job is to catch a bug in
one handler is not worth its name; that handler bounds its own loop or sets its own `timeout`.

### D2 — The deadline is RUN-scoped and it aborts the run

Every RPC goes through the memo, so calls coalesce. Caller B joining A's in-flight run at `t = T-1ms`
gets an effective 1ms window. That is correct and is what coalescing means everywhere else in abide
(a `peek` on a joined slot does not restart it either): B is not being cheated, B is *observing a
call already in flight*.

The alternative — a per-caller timer that abandons the waiter but leaves the run alive — was rejected
on two counts. It orphans a handler burning a connection with nobody reading it (the exact leak
`requestScope.ts`'s retain warning exists to catch), and it gives two callers of one slot divergent
outcomes, which breaks the memo's core promise that identical `status`/`value`/`error` is one state
object and one wake-up (`rpc-core.md` §7.3-7.4).

### D3 — A caller's signal aborts the caller's WAIT; `timeout` aborts the WORK

`fn(args, { signal })` is added to the call surface. The asymmetry with D2 is deliberate and is the
principle:

> `timeout` is the **author's** statement that the work is worthless after `T`.
> A caller's signal is the **caller's** statement that they stopped caring.

The author owns the work; the caller owns their wait. This also means **no per-call timeout argument
ever needs to exist** — `fn(args, { signal: AbortSignal.timeout(500) })` is one, composed from the
platform.

**Shape.** `fn(args, { signal })`, and `fn(undefined, { signal })` for a zero-arg RPC. The trailing
options slot does not let the leading arg slot collapse — which is already law here: *"a zero-arg RPC
infers `Args = unknown`, not `void`, so `rpc.publish(args, value)` still takes the arg slot"*
(`CLAUDE.md`, surface verbs). One more verb following a rule, not a new exception.

### D4 — A client abort kills the server's run unless `crossRequest: true`

Aborting the fetch closes the connection; Bun fires `request.signal`. Whether that kills the server's
run is decided by one already-meaningful flag:

- **not `crossRequest`** — the slot lives in the request's own scope (`memo.ts:544`:
  `return crossRequest ? sharedStore() : reactiveScope().slots`). The request is dying, every slot in
  it dies with it, and no later reader can ever observe the fill. Kill it.
- **`crossRequest: true`** — the slot lives in the process-global store and a *different* request
  will read it. The originating request's death is not the run's death. Let it finish; only the
  deadline kills it.

This is not a new policy so much as the generalization of one already shipped for streams —
`memo.ts:892-905`, `onStreamRefCountZero`: *"for a still-open stream everyone abandoned, abort the
source unless it is a retained (`crossRequest`, `ttl > 0`) run that should complete for a late
joiner."*

**Rejected: extending the awaiter refcount to value slots.** A stream cursor is an explicit object
with a lifecycle, which is why it earned a refcount; a value read is a bare `Promise` and nothing
tracks its awaiters. Building that would put enter/exit bookkeeping on the hottest path in the
framework (every `{await fn()}` template slot) to observe an event that almost never fires — and the
payoff is asymmetric: an abandoned *stream* produces indefinitely, while an abandoned *value* run
finishes once and stops, its waste already bounded by this very deadline.

So the kill table is four entries, each with a distinct owner:

| killer | kills |
|---|---|
| the author's `timeout` | any run |
| request death (client abort) | that request's non-`crossRequest` runs |
| last cursor detached | a non-retained stream (already shipped) |
| a caller's `signal` | that caller's wait |

### D5 — The signal is composed from web standards and carried on the substituted `Request`

```ts
crossRequest  →  AbortSignal.timeout(T)
otherwise     →  AbortSignal.any([AbortSignal.timeout(T), original.signal])
```

D4 in two lines, with no abide-specific machinery.

**No new export.** The router substitutes `new Request(original, { signal })` on scope entry, so a
handler writes the completely standard `fetch(url, { signal: request().signal })` — an idiom every
Bun/Node/Deno author already knows, and a clean superset of the platform meaning ("stop, nobody will
use your answer").

**Rejected: a `signal()` ambient.** Two reasons. `signal` is a word this project deliberately
*retired* — the reactive primitive was renamed `signal` → `state` to stop colliding with TC39
Signals, and `abide/server/signal` re-imports the exact ambiguity that rename removed. And every
other ambient (`request()`, `cookies()`, `identity()`, `context()`) is request-scoped while this one
would not be. Passing it as a second handler argument is likewise out: it breaks the one-positional-
argument law the entire input-schema derivation rests on.

**Two costs accepted, both real:**

1. **An ordering constraint becomes load-bearing.** The substitution must happen *after* route
   resolution (the timeout is per-RPC) and *before* the body is read — `new Request(consumed)`
   throws. Today's order in `router.ts` already satisfies this; it now needs a comment saying it must.
2. **A `crossRequest` handler gets no cooperative teardown.** It runs outside the request scope by
   design (`memo.ts:741`: `const promise = crossRequest ? exitScope(runLoad) : runLoad()`), so
   `request()` is unavailable to it. Its deadline is enforced at the waiter only. That is the gap, and
   it is the expensive shared handler one would most want to kill — recorded here rather than papered
   over, and fillable later without a breaking change.

**The abort is COOPERATIVE.** JS cannot preempt. A handler that ignores its signal and does
`await sleep(600_000)` keeps running; the framework guarantees only that the caller is released and
the slot settles. Real teardown requires the handler to thread the signal.

### D6 — Bilateral means two independent enforcements, not one timer with two ends

The client timer runs from `fetch()` (`clientProxy.ts:153`) and includes DNS, connect, HTTP/1
connection queueing, and body read; the server timer runs from handler dispatch and includes none of
it. With one number `T` on both sides the client's window strictly *contains* the server's, so for
browser-originated calls the client always fires first.

That is not a bug to tune away with a grace factor, because the two answer different questions: the
client's is *how long the user waits*, the server's is *how long the app works*. A grace constant
would be an unmeasurable magic number, and a server-only design cannot fire at all when the server
never answers — the single most common real timeout.

The diagnostic cost (a client-side abort is invisible server-side) is already paid for: a browser RPC
call carries a child `traceparent`, so the abandoned server span exists in the trace.

**`.raw()` is included.** On the client it arms the same `AbortSignal.timeout(T)`, composed with a
caller-supplied `init.signal` rather than replaced by it.

> **AMENDED.** The server half of this was a claim, not a mechanism: `.raw` called the handler and
> awaited it bare, so it was the one read with no deadline at all. `.raw` is now the bare call with a
> `Response` return, so the MEMO's deadline bounds it — the same one, on the same slot, for every caller
> coalesced onto it — and `init.signal` is forwarded as the call's own `{ signal }`, which detaches this
> waiter without ending the run. A trip is answered as the 504 (`timeoutResponse`, shared with the
> router) rather than escaping as a `DOMException`, because `.raw` is a Response surface and that is the
> status a browser `.raw` receives for the same trip.

### D7 — `TimeoutError` / **504**, and the slot is EXPIRED, not disposed

The error type comes free. D5 uses `AbortSignal.timeout(T)`, which aborts with a platform
`DOMException` named `TimeoutError`, and `clientProxy.ts:232` already narrows on
`e.kind === name || e.name === name` — so `fn.isError(e, 'TimeoutError')` works on the client abort
with no new code. The server side mints `error.typed('TimeoutError', 504)` through the existing typed-
error mechanism so both sides narrow identically instead of one seeing a `DOMException` and the other
a bare 504. **504**, not 408: 408 means the *client* was slow sending.

Left alone, a timeout would poison its slot permanently. `memo.ts:644` puts an `'error'` slot on the
same ttl clock as a value slot, and a read's default ttl is ∞ — so `memo.ts:1132` would re-reject
every subsequent call with the cached `TimeoutError` and never retry. The failure most likely to
succeed on retry would be the one cached hardest.

The fix is **expire, not dispose**. `c.error` reads `slot.state()` with no expiry check, while the read
path gates the cached rejection behind one (`isRetentionStale`, `shared/internal/slotRetention.ts` — this
ADR was written when that predicate was `isExpired`, local to `memo.ts`, and had a second copy for the
auto-tracked path). Stamping a `TimeoutError` slot as immediately expired therefore keeps
`fn.error()` reporting it *and* makes the next read run cold. `disposeSlot` was the first instinct and
is wrong: deleting the slot blanks `fn.error()` at once, so an error banner would flash and vanish.

Scoped to *timeout* errors only. A 404 or a validation failure should stay cached; retrying those is
pointless. (Separately noted, not decided here: "all errors retained at ttl:∞ forever" looks like a
live bug independent of this feature.)

### D8 — A stream trip goes through the SSR error path that already exists

`stream.abort()` on the run (`memo.ts:902`) rejects the cursor's `next()`, which lands in the catch
`streamScheduler.ts:347-352` already has:

```ts
} catch (error) {
    markIterableDone(source)
    if (handle !== null) dropHandle(scope, handle)   // errored → drop the handle (client re-runs).
    if (config.caught !== null) yield { op: 'append', html: await config.caught(error) }
    yield { op: 'complete' }   // an errored stream is finished → the client claims it.
}
```

A deadline trip **is** an error, so it inherits that policy: handle dropped (no stale mode-B seed),
the `{:catch}` branch rendered *server-side with the `TimeoutError` in the SSR HTML*, and the client
re-running cold while hydration clears the painted region (`streamScheduler.ts:358`).

**`streamScheduler.ts` needs no code change** — only its comments corrected. Two alternatives were
considered and both are worse: keeping the handle so the client resumes `?__abide_from=N` and hits
`resumeFresh` invents a second policy for one event class *and* skips the `{:catch}` branch; closing
the stream cleanly as `done` is silent truncation, which the project's own rule forbids — the client
could not distinguish "finished" from "gave up".

### D9 — Default 300_000 (5 min): a fallback CEILING, not a tuned bound

`envMs('ABIDE_RPC_TIMEOUT', 300_000)`, the same helper and the same number as
`ABIDE_SSR_STREAM_BUDGET` (`streamScheduler.ts:69`). The two stay independent constants that happen
to agree; they bound different things.

It cannot be infinite — an unbounded default ships the `streamScheduler` exemption with nothing
behind it, which is the hole this ADR exists to close. It is deliberately *not* a tight UX number
either: the framework's job here is a ceiling, and a per-call UX bound is the caller's (D3).

This makes the SSR exemption statable truthfully for the first time, and the difference is not "it
has a bound and you don't":

- a **non-abide** source gets 5 min of *total wall-clock* from first arm (one timer per render,
  `renderState.ts:33`) and is cut even while perfectly healthy;
- an **abide** source gets 5 min of *idle*, so a healthy stream runs for hours.

**`timeout: 0` / `Infinity` is a legal opt-out and is LOUD** — a warning on the `abide:rpc` channel at
construction, in the manner of `deriveSchema`'s `any`-param warning. An unbounded RPC re-opens the SSR
streaming exemption for itself, and that is worth one line of noise.

**Client-side, the default is baked at build time.** `opts.ttl`/`opts.memo` already cross into
`clientProxy.ts:145,167`, so `timeout` rides the same channel — meaning `ABIDE_RPC_TIMEOUT` retunes
the server at deploy while the browser keeps whatever `abide build` baked. Accepted rather than routed
through the hydration seed: the client timer is a UX bound, and a deploy-time retune of a UX bound is
not worth a new seed field.

## Tests

A green suite is what this rot looked like, so the tests are part of the decision. **No test uses the
5-minute default**; every one declares `timeout: 50`.

1. **Per shape** — value read, value mutation, streaming read, streaming mutation. Four, because D1's
   progress-vs-total distinction only differs across shapes. Each asserts **the handler's signal
   fired**, not merely that the caller rejected: a `Promise.race` with a detached handler passes a
   caller-side-only assertion while doing none of the work the feature exists for — the project's own
   rule that a correctness test cannot guard a "does less work" contract.
2. **Progress re-arms the clock** — a stream at `timeout: 50` yielding every 20ms survives past
   200ms. The only test that distinguishes D1 from total-wall-clock; without it a total-duration
   implementation passes everything else.
3. **The `crossRequest` fork (D4)** — client aborts mid-flight; the non-`crossRequest` handler
   observes its signal, the `crossRequest` one does not. Invisible to every other test.
4. **The SSR guard (D8)** — a page with a hung abide `{#for await}` renders its `{:catch}` and
   completes the document instead of holding the flush. This is the regression guard for the three
   false comments, and the one that fails today.
5. **Expiry, not disposal (D7)** — after a timeout, `fn.error()` still reports it **and** the next
   `fn(args)` re-runs. Both halves asserted; either alone passes on the wrong implementation.

## Surfaces to correct

The current text asserts a built feature, so this is a correction, not an addition.

- `docs/spec/rpc-core.md` §4 — restate `timeout` as progress-based with the D4 fork.
- `CLAUDE.md` — the `timeout` row in RPC `opts`, the `ABIDE_RPC_TIMEOUT` env row, and the call-surface
  table (`fn(args, { signal })`).
- `streamScheduler.ts:224,328` · `renderState.ts:36` · `requestScope.ts:128` — the exemption is
  *idle-clock vs total-clock* (D9), not *bounded vs unbounded*.

## Landed

Three things the design missed. All three were mechanism, not decision — every D above holds as
written — and the first two are the kind that a passing test suite reports as success.

### 1. "Settled but expired" could not be a `loadedAt` stamp

D7 was first built by stamping a timed-out slot's `loadedAt` at `-Infinity`, on the reasoning that
`Date.now() - -Infinity` is `Infinity` and so expires against every ttl. It never fires: `isExpired`
opens with `if (ttl === Infinity) return false` — a short-circuit **before** the clock is consulted, and
`Infinity` is exactly a read's default ttl. The retry silently kept re-rejecting from the cached slot.

Replaced with an explicit `slot.expired` flag, checked ahead of the ttl short-circuit and cleared in
`startLoad` (a new run supersedes the expiry, which is what keeps one cold retry from becoming a
permanent one). The general lesson is narrow but sharp: **a value encoded into an existing field only
works if every reader actually reads that field**, and this one deliberately does not.

Caught by the D7 test asserting both halves at once — the probe half passed, the re-run half failed.
Either assertion alone would have gone green.

### 2. `timer.refresh()` broke every stream in the browser

The stream watchdog re-arms one timer per chunk rather than racing `next()`, and used the Node/Bun
`Timeout.refresh()` to do it without allocating. But `shared/memo.ts` is ISOMORPHIC: in the browser
`setTimeout` returns a **number**, `timer.refresh()` throws `TypeError`, the throw lands in the pump's
own `catch`, and that catch calls `stream.fail(...)`. Every `{#for await}` in the client bundle broke —
a whole-stream break from a per-chunk cause, presenting as a stream error rather than as a crash.

**No unit test could see it.** happy-dom runs the same server-side path, so all 1398 stayed green; the
docs-app Playwright suite failed 9 streaming specs immediately. This is the second time that split has
been the only detector, and it generalises past timers: an isomorphic module may not reach for a
runtime-specific API without probing for it.

Fixed by probing the capability ONCE at arm time and keeping each branch monomorphic (`refresh()` on
the server, `clearTimeout` + re-arm in the browser), rather than re-arming blindly on both.

**Since moved to `shared/internal/streamDeadline.ts`**, with the timer pair as a PARAMETER (defaulting
to a module constant, so a stream still pays one property load rather than a closure). The fix above is
unchanged — that module does exactly what this paragraph describes — but its LOCATION was the reason the
branch stayed untestable: `test/happydom.ts` deletes global `window`, so `bun test` always presents a
Node timer and the browser branch could not be selected by any unit test however it was written. With
the substrate injectable, eleven tests choose it and assert the WORK the design is about — a hot stream
on the node substrate allocates exactly ONE timer for 100 chunks, while the browser substrate clears and
re-sets per chunk. Re-arming blindly reds three of them, including the throw itself.

### 3. The call tuple could not be built by spreading

`(...args: [...RpcCallArgs<Args>, options?: RpcCallOptions])` looks like the composition of D3's
trailing options onto the existing tuple, and type-checks. But a tuple with an **optional** element
cannot be spread and then extended — the appended member is dropped, and only the zero-arg case shows
it (`fn(undefined, { signal })` → *"Expected 0-1 arguments, but got 2"*). Spelled out instead as
`RpcInvokeArgs`/`MutationInvokeArgs`, leaving the probes on the plain `RpcCallArgs`, which is more
honest anyway: per-call options belong to the CALL, not to `peek`/`pending`/`error`.

### Also worth recording

- **`streamScheduler.ts` needed no code change**, as D8 predicted — the deadline reaches its existing
  `catch` through `stream.fail`, and only its comments were wrong.
- The client bundle grew **~2.5 KB** (`withDeadline`/`withAbort`/`isTimeoutError` + the watchdog cross
  into the browser because the memo and the rpc proxy are isomorphic). `bundleSize.test.ts` raised
  112 KB → 116 KB; the bundle is unminified there, so most of that is comments.
- `envMs` was a private function in `streamScheduler.ts` and is now `shared/internal/envMs.ts`, so the
  SSR deadlines and the run deadline parse their tunables identically.
