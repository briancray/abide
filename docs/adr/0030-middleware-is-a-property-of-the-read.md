# ADR 0030 — middleware is a property of the READ, and the global chain is a property of the REQUEST

**Status:** accepted, built.

## Context

`middleware` is `(next) => Response`. `auth.md` FD1 states that authorization IS middleware, and the same
signature carries tracing, rate limiting, per-request context population and response post-processing. So
"which callers run an rpc's middleware" is not a transport question, but it had a transport answer: the
ROUTER composed the chain, and `makeRpc` built only handler + memo + deadline.

Everything that reached an rpc without going through the router therefore ran no middleware at all:

- **page SSR** — an emitted page module calls the callable directly,
- **a handler reading a sibling rpc** in-process,
- **a cron tick** or any other scope-free caller,
- **an `abide run` migration**.

The read was not merely unauthorized on those doors, it was **unobserved**: no span, no rate-limit hit, no
context. And the gap was invisible in the one place it mattered most — a `middleware: [requireAdmin]` on an
rpc read by a page looked like a guard and was not one.

Two further facts shaped the decision rather than merely motivating it. First, `callOwnRpc` existed
*because* of this: MCP and `agent()` dispatch over the app's own HTTP loopback, and half of the stated
reason was "the router composes the middleware". Second, `channelAuth` had already solved the same problem
for a `@rpc:` WebSocket join, and solved it correctly — including synthesizing a request-shaped scope — so
there was a working precedent in the tree that the main read path did not follow.

## Decision

**An rpc's own `middleware` runs per READ, from every door. The app's global `config.middleware` runs per
REQUEST, wherever a request exists to authorize.** Four sub-decisions make that precise; each was a real
fork, and three of them were got wrong first.

### D1 — the chain wraps the CALL, never the memo body

The obvious implementation is to wrap the handler, i.e. the memo's body. It is wrong for authorization, and
quietly so: **a memo coalesces by ARGS, not by identity.** Two principals reading the same args share one
run, and would share one middleware run with it — the first caller's authorization standing in for the
second's. So the chain wraps the call, outside the memo, and the memo coalesces the work underneath it.

Consequence, deliberately accepted: a read served entirely from a retained slot still runs the chain. That
is the correct trade — the chain is what decides whether *this caller* may have the value, and a cache hit
is not an authorization.

### D2 — the router uses an un-chained entry, so the chain runs exactly once

If the router kept calling the ordinary callable, every HTTP read would run its middleware twice. The route
surfaces therefore expose `__bare(args)` — the same producer minus the chain — and the router invokes that
inside the chain it composes around the whole of dispatch.

Composing around *all* of dispatch, rather than around the invoke, is what puts arg decoding and
`schemas.input` validation INSIDE authorization: **a 422 must never precede a 403.** A caller who is not
allowed to reach the rpc must not be able to learn its input schema by sending a malformed body.

`__bare` is handed in by each factory rather than rebuilt from the memo at the seam, because a mutation's
producer is not "call the memo": a `FormData` body and `memo: false` both bypass it. Rebuilding that branch
routed every multipart upload through the memo.

### D3 — `route()` inside the chain names the READ, not the caller

**This is the sub-decision that made the difference between a feature and a trap.** `auth.md`'s canonical
guard is `route().name === 'deleteUser' && … error(403)`, and `route()` answers from the active reactive
scope. Run the chain in the caller's scope and during page SSR that scope is the NAV's — so the guard sees
`kind: 'nav'` and the page's pattern, and **silently never fires**. Running the middleware with the wrong
subject is worse than not running it: not running it is honest, and this looks like coverage.

So the chain runs in a scope whose `route()` describes the read: `{ kind: 'rpc', name, params: args }`,
built the way `channelAuth` already built it for a join, so the two non-HTTP doors describe a read
identically.

Three things about the shape, each load-bearing:

- It is a **shallow copy that shares the `slots` Map**, not a fresh scope. `currentScope()` resolves the
  request scope by comparing its `slots` to the active reactive scope's BY IDENTITY, so sharing that one Map
  is exactly what keeps `request()`/`cookies()`/`context()` answering the caller's real request while
  `route()` answers the read. `identity`/`identityWrite`/`traceparent` come along by the copy, so a
  middleware's `identity()` is still the caller's principal.
- It is a **scope, not an assignment.** Mutating `scope.route` and restoring it in a `finally` is cheaper
  and wrong: a page firing eight reads concurrently is the documented case, and those reads would clobber
  each other's subject between the set and the restore. `AsyncLocalStorage` isolates them; a field does not.
  `rpcChain.test.ts` pins this with concurrent reads, and the guard fails on the assignment form.
- The **read itself runs back in the caller's scope** (`exitScope` when there is none). The override is for
  the middleware; the read's memo slots, effect scopes and disposers belong to whoever asked for it.

`url` is the one field this cannot answer truthfully from a scope-free door, so it is a documented stand-in
and guards should key on `params`.

### D4 — the global rung runs where a REQUEST exists, and nowhere else

The first implementation selected the global rung with `owesGlobalChain()` = `currentScope() === undefined`,
read as "no request has run it, so run it". That conflates two different questions — *has* a request run it,
and *should* it run here — and answering the second with the first produced a landmine: a scope-free read
ran the global chain with no request behind it, so an app's own tracer or rate limiter reached for
`request()`, threw, and (because a chain that does not reach its terminal fails closed) **failed the read
inside the middleware whose job was to observe it**.

The global chain is per REQUEST. It therefore has exactly two composers, both of which have a request:
the router at mount, and `channelAuth`'s `@rpc:` join, which synthesizes one precisely so it can run it.
A value call runs the own rung only. `rpcChainFor`'s boolean parameter is gone, and its absence is the
decision.

## Rejected alternatives

| alternative | why not |
| --- | --- |
| Wrap the memo body | D1: coalescing is by args, so one caller's authorization would serve another's read. |
| Leave it to transport; keep the loopback | This is what `callOwnRpc` did, and it does not generalize: page SSR cannot make an HTTP request to itself per read, and a sibling read would pay a round trip for a guard. The loopback survives for a *narrower* reason — see below. |
| Run both rungs from every door | D4. Double-counts a page's reads in the global chain, and reaches `request()` from doors that have none. |
| Run the chain in the caller's scope as-is | D3. The documented guard idiom silently never fires on the SSR door. |
| Synthesize a FULL request scope for an in-process read (as `channelAuth` does) | Rejected as too much: a join genuinely has no scope of its own, but an in-process read is inside a real request whose `request()`/`cookies()`/`identity()` are exactly what the middleware should see. Overriding only `route()` is the minimum that makes the guard idiom true. |
| Install the chain in `createApp` only | Where the first build left it, and the source of two silent holes — see D5 below. |

## D5 — one installer, called by every boot

The chain was installed by a loop inside `createApp`. That made "which door built the app" decide whether a
read is authorized, and it opened two holes that no test caught:

- **`abide run` never calls `createApp`** (it boots through `appLifecycle` with `boot: () => undefined`), so
  a migration's reads went straight to the handler, past every guard its rpcs declared. `cli-lifecycle.md`
  CL2 said "the middleware chain does not run under `run`", which was written when the per-request rung was
  the only one and read as a design statement about requests, not about reads.
- **`abide dev`'s rebuild reassigns `config.routes`** to freshly imported callables. The router reads the
  registry live per request, so dispatch picked them up — but everything DERIVED from the registry did not.
  From the first file save onwards, per-rpc `middleware` and declared `crossOrigin` silently stopped
  applying, in the surface an author does all their work in.

So the installer is `bindRpcChains(config)`, called by `createApp`, by the dev server's rebuild
(`App.rebind()`, which re-derives all four per-surface bindings), and by `abide run`. Binding is idempotent
— it replaces the runner rather than nesting — so a rebuild cannot end up running a chain twice.

A test for the `run` door has to use a `run`-shaped harness: the scope-free test in `rpcChain.test.ts` boots
through `createTestApp`, which *does* call `createApp`, so it passed while the door it named ran nothing.

## Consequences

- **`callOwnRpc`'s rationale narrows.** MCP and `agent()` still dispatch over the loopback, but only for
  **input validation** of args a MODEL wrote: validation is applied by the router, so an in-process call
  would advertise a schema and never enforce it. Middleware is no longer part of that argument.
- ~~**`fn.raw()` is outside the chain**, by construction — it calls the handler, not the producer. It is the
  one read surface that is neither coalesced nor authorized, and that is now stated wherever `.raw` is.~~
  **SUPERSEDED.** `.raw` now calls the chained producer like every other door: it is the bare call with a
  `Response` return, so it is coalesced, authorized and deadline-bounded, and the encoding is the only
  difference from `fn(args)`. The carve-out did not survive being written down — "the one read surface
  that is neither coalesced nor authorized" is a description of a hole, and `middleware` is tracing and
  rate limiting as well as auth, so the surface an author reaches for to inspect the wire was the one
  surface nothing observed. What it costs is that a `json(data, init)` helper's status/headers no longer
  reach `.raw` (the memo sees through to `data`); a handler shaping bytes returns a plain `Response`,
  which is still the memo's value and still passes through whole.
- **`__bare` and `__bindChain` are `__`-prefixed** for the reason `__rpc` is. Un-prefixed, `.bare()` sat in
  the autocomplete of anyone importing an rpc, next to `peek` and `refresh`, reading like a supported call —
  and it skips what `auth.md` calls auth. Declared once on `ServerRouteMembers` for both route surfaces,
  which also fixed a silent asymmetry (`Rpc` had them, `StreamRead` did not, though one factory builds both).
- **A deliberate outcome inside a page render is rendered at its own status.** A gated read can now
  short-circuit mid-paint, so the nav catch had to stop turning `error(403)`/`redirect('/login')` into a
  generic 500. That was already wrong for a page calling `error(404)` itself; the per-read chain made it
  reachable a second way.
- **A middleware may now run more often than before.** A page with eight reads of guarded rpcs runs eight
  own-rung chains. That is the intended cost of the chain being part of the read; the global rung is where
  per-request work belongs, and it still runs once.
- The residual asymmetry between an in-process read (`route()` overridden, caller's request kept) and a WS
  join (whole scope synthesized) is deliberate and recorded above, not an oversight to be unified later.
