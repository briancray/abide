# The server runtime

## What this document is

A **plan**. It answers one question: *what happens between a socket and a handler, and what holds
the two together?*

Nothing here is decided. The four documents carry what has been decided, and a statement in this
file that turns out to constrain behaviour becomes a clause in RULEBOOK.md — after which this
document cites the number rather than keeping the sentence, because a second copy drifts and only
one of them gets fixed. Where this plan refuses an alternative, the refusal is owed a DECISIONS
entry before the code lands, not after.

`src/server/index.ts` is `export {}` today, so this is a first landing rather than a refactor.

Delete this file when the last stage below has landed. A plan that outlives its work is read as a
description of the code, and it is the one document nothing checks.

**And nothing checks it while it runs, either.** This file cites 195 distinct clauses and decisions
and *schedules amendments to eight of them*. 16.14 alone is cited in eighteen places across twelve
sections, and stage 7 strikes one of its members and redefines a second — after which the sentences
here that lean on the striking still resolve and no longer hold. That is D3's shape reproduced
inside one file, on a schedule the file sets. So each amendment bullet in "What the docs owe" names
**the lines in this file it falsifies**, which is CLAUDE.md's grep-the-number discipline applied to
the one place nothing else will apply it.

Every number in the paragraph above was wrong until it was counted: it read "119 clauses",
"amendments to four", "cited in nine places" and "stage 5". Four figures, four errors, in the one
paragraph asking to be trusted on exactly this — and each was a `grep -c` away. A self-audit that
is not itself run is worse than none, because the next reader spends it instead of counting. The
counts are `grep -o` over this file against the id sets in `docs/RULEBOOK.md` and
`docs/DECISIONS.md`; re-run them when this file changes, because nothing else will.

## The decision everything else falls out of

**There is one call path, and the wire is a decoder and an encoder wrapped around it.**

16.4 makes an `Rpc` callable in both arms and D15 puts a rung on the in-process call too, so a
runtime with an http path beside an in-process path holds two implementations of the one thing that
must not differ — authorisation. 16.14 already reads as a list of steps a wire *adds*, not as a
second lane.

```
Request ──decode──▶ Call ──onion──▶ handler ──production──▶ encode ──▶ Response
in-process ─────────▶ Call ──onion──▶ handler ──production──▶ Reactive
```

`Call` is a class whose every field is filled at construction, `undefined` included — the hot-path
rule, because a `Call` is allocated per request and per in-process read a render makes.

The nine fields, enumerated here the way `Scope`'s ten are below, because a plan that names a field
where it first becomes relevant is how a shape grows conditionally: the target `Rpc`, the decoded
arguments (`undefined` until `ctx.args()` runs), the **args cache** (`undefined`, filled by the
first `ctx.args()` — see the 16.18 fix below), the `Scope` it runs in, the `wire` (the `Request` on
the decoded arm, `undefined` in-process), the method, the address, the rung cursor, and the
`AbortSignal`. `call.wire` and the args cache are the two this plan used before it listed them, and
both were added on a later path in the reading rather than at construction. Neither is optional now:
`undefined` is a value, and the shape is the same on both arms of the diagram — which is the point
of there being one call path at all.

**The condition is on the `Call`, never on the `Scope`.** The steps 16.14 names are conditioned on
`call.wire !== undefined` and are inert otherwise, which is CLAUDE.md's
uniform-with-an-inert-variant shape and the one D89 already used for a status written through
`response`. Writing it as
`scope.wire` is wrong and the failure is silent: a render-time rpc read is an in-process call
*inside a scope that has a wire* — D89's own case, "a handler read in process during a render is
answering into the page's response" — so a `scope.wire` test runs the `Origin` gate, `maxBodySize`
and the preflight on every render-time read, and lets a status written inside a seeded read set the
**page's** status. The two spellings agree on every wire call and on `app.run` with no request, and
disagree on exactly the call the seed exists for.

**One exit, and what it does not cover.** 21.1 and 21.2 have *every* answer carry `nosniff` and
`traceresponse` — a refusal (16.44), a fault (16.45) and a handler's own `Response` (16.39)
included. That is only cheap if there is exactly one place a `Response` is constructed, so `encode`
is it. Two qualifications, both of which cost something and neither of which was priced before:

* **A handler's own `Response` cannot be amended in place.** `Response.redirect()` and anything
  handed back from `fetch()` carry the immutable headers guard, so `encode` calling
  `headers.set('x-content-type-options', …)` on one *throws* — at the single exit, for a spelling
  16.39 explicitly permits. So the pass-through is not a pass-through: `encode` builds
  `new Response(handed.body, { status, statusText, headers })` with the two generated headers added.
  That is one extra `Response` and one extra `Headers` on that arm, and it belongs in the budget.
* **The asset route is in front of the pipeline and never reaches it.**
  `content/server/answer-with-something-other-than-json.md:129` already says so, and 21.6's
  `immutable` is answered there. "One exit" means one exit for anything a handler or a page
  *produces*; the built bundle is served by `Bun.serve`'s own static route from the manifest, and
  its headers are 21.6's rather than 21.1's. See "The tables".

## Files

Under `src/server/` except where noted. Naming per CLAUDE.md, "writing code": a constants leaf is
UPPERCASE, a class file is TitleCase, a util is camelCase.

| File | Exports | Carries |
| --- | --- | --- |
| `#shared/INTERNAL_ADDRESSES.ts` | the `/__abide/**` addresses | a leaf, no imports of its own — and **not under `src/server/`**: the compiler bakes these addresses into the emitted client module, so a server-side home is reached either by a relative path across the seam or by `#server/…` from `src/ui`, which is the thing the seam layout exists to stop |
| `#shared/FRAMINGS.ts` | the chunk-type → framing table | D91's table, indexed rather than branched. Shared because the client decoder needs the same jsonl/sse/bytes set (17.10). It is **not** a constants leaf and must not be UPPERCASE if it grows an `import type` — `conventions.test.ts`'s leaf check is `/^import\s/m` and does not exempt type-only imports, so naming it UPPERCASE opts it into a gate it then fails. Either it stays import-free or it is `framings.ts` |
| `Scope.ts` | `Scope` | the per-request record — the ten fields "The scope" lists, every one filled at construction |
| `currentScope.ts` | `enterScope`, `currentScope`, `requireScope` | the `AsyncLocalStorage`, and 22.1's throw |
| `RouteTable.ts` | `RouteTable` | built once at boot; the exact map, the page trie and the asset manifest |
| `compose.ts` | `compose` | 16.15's onion, folded once per entry |
| `Call.ts` | `Call` | the fixed-shape call record both arms allocate |
| `invoke.ts` | `invoke` | the one call path |
| `decode.ts` | `decode` | `Request` → `Call`, the wire-only prefix, and `maxBodySize`'s 413 before a body is read |
| `encode.ts` | `encode` | production → `Response`: framing, status, the generated headers |
| `flush.ts` | `flush` | the generator → `ReadableStream` pump, and 35.10's batching |
| `page.ts` | `servePage` | the layout chain, the `Shell`, head merging — see "The page path" |
| `preflight.ts` | `preflight` | 16.26's `OPTIONS` answer, and the closed `vary` set |
| `faults.ts` | `onFault` | 37.5's hook, 16.42's html navigation, and what a mid-stream throw does |
| `SeedStore.ts` | `SeedStore` | detached render entries, one timer over the earliest expiry, cleared on `stop` |
| `Mux.ts` | `Mux` | 18.2's single web socket mux |
| `App.ts` | `App`, `createApp` | tables, onions, hooks, rooms, seed store — everything but a socket |
| `listen.ts` | `listen` | the one `Bun.serve` call and the in-flight drain — tcp only, the unix arm having gone with the dev worker |
| `hooks.ts` | the eight of 37.x and 25.3 | registration, replacement and the 37.7 warning |
| `log.ts` | `emit` | the runtime's own producers — `abide:request` per request, `abide:socket` per event (28.1) |
| `ambient/*.ts` | `request`, `response`, `cookies`, `principal`, `trace`, `csp`, `health`, `server`, `config`, `route`, `online`, `log` | one file per name |
| `surfaces/*.ts` | health, principal, config, openapi, mcp, logs | each an ordinary entry in the table |

Twenty modules plus two directories, against seventeen rows in the first draft of this table — the
growth is findings 12, 13, 14 and 17 of the review, not scope creep, and it is the honest input to
the machinery budget below. The number this plan previously nominated as "actually budgeted" was
the public names `abide/server` adds, which is the most flattering of CLAUDE.md's three; all three
are now in "What it costs".

## The scope

`REACTIVE.md` lists "where a scope lives" as its own open question. **This answers one third of
it.** That question asks for one owner mechanism serving 10.5 (`state.share`, scoped to the
component instance *and its descendants*), 11.34 (the request-local memo on a server) and 13.8
(`Selection`, scope-bounded). What follows is 11.34. 10.5 needs a **nested stack** pushed and popped
per component instance during the render, and this design's store is a flat per-request record
entered once — so 10.5's owner is still unwritten, and REACTIVE.md's question stays open until
`RENDERER.md` says where that stack lives.

A `Scope` is one fixed-shape record per request, **every field filled at construction, `undefined`
and empty collections included** — the same hot-path rule `Call` gets, and for the same reason:
a `Scope` is allocated per request and per `app.run`. The ten fields are the wire (the `Request`, or
`undefined`), the response being built (22.11), the cookie writes (22.3), the trace (24.1), the CSP
nonce (29.3), the timeout floor (16.24), the disposer list (12.6), the sink table, the seed entries,
and the **request-local memo entry map** (11.34). Four of those are collections, so a request that
memoizes nothing and disposes nothing still allocates them — which is the fixed-shape rule choosing
a known cost over a hidden class transition, and it is in the budget rather than hidden in the word
`Scope`.

**The runtime introduces no caching, no per-request storage and no invalidation of its own — with
one exception, and it is named.** D52 found that `config` already had every part of a `memo`; D88
found the same for the per-request bag and called it the third such finding. Continuing is the whole
design: `principal` is a request-local memo whose body is the resolve, so 26.15's at-most-once and
26.2's shared resolve are 11.40 rather than machinery; `health` is a memo; `config` is a `global`
one by 27.10. Anything the runtime wants to compute once per request is a memo filed under the
scope.

The exception is the `SeedStore`: entries outlive the scope that made them, keyed by an id, evicted
on a TTL. That is caching, per-visitor storage and invalidation, all three, and calling the
invariant absolute is what would license skipping the bound. It does not get skipped — see "The
seed buffer", where the bound and the eviction policy are owed a number and an env name.

### `AsyncLocalStorage`, entered once

Tracking needs no async propagation because D11 made it synchronous, but the ambients do: a handler
that awaits a database and then reads `request()` must find its own scope. Bun exposes no
equivalent — all 118 own properties of `Bun` in 1.4.0 checked, no async-context primitive of any
kind — so this is a `node:async_hooks` import with the comment CLAUDE.md requires. It is a real
implementation there, not a stub: `getStore()` propagates across `await`, `setTimeout`, `Bun.sleep`
and nested async functions, and returns `undefined` outside the run.

Two bounds keep it from spreading, and **only one of them is funded today**:

* The store holds **the scope reference and nothing else**, and it is entered exactly once per
  request, at the outermost point in `App.fetch`. This one holds.
* The compiled render program should take the scope as a parameter so the per-node path never
  touches the store. This plan previously claimed `RENDERER.md`'s `stream(context)` already does
  that. It does not — `context` there is the setup's reactive values (`const rows = context.rows`),
  and no scope appears in that plan. So either the render signature grows a scope parameter beside
  `context` (not merged into it: putting the request in reach of every compiled node is the thing
  the bound exists to prevent), or ambients read inside a render body hit `getStore()` per read.
  **This is a handoff RENDERER.md owes and does not yet carry.**

**`getStore()` is measured, and the answer is: do not cache it.** Two runs, 5M iterations, JSC —
which is the right substrate, this being server-only — with a non-elidable sink:

```
als.getStore().a          3.01 ns/op   (second run 2.87)
cached local  .a          1.13 ns/op
parameter thread          0.72 ns/op   (baseline)
als.run(scope, syncFn)   11.30 ns/op   against 4.05 for the bare call
```

Against a 33.2 µs loopback request through `Bun.serve`, one `getStore()` is **0.0087%** and three
ambient reads are **0.026%**. Caching in a local is machinery for nothing and comes out of the
budget. The async-propagation tax measured at 4% and 11% on a ten-`await` chain across two fresh
processes — the arms nearly meeting on the second run, which is the answer: noise floor, not a tax.

Note the inversion this corrects. `AsyncLocalStorage`'s *time* is negligible; its *allocation* is
not — `als.run()` costs six heap objects over the bare async call — and this plan had it backwards,
budgeting the lookup and ignoring the frame. See "What it costs".

## The tables

19.1 and 19.2 mount by file path and export name and make a collision a **build** error, so nothing
is resolved at run time and there is no first-request race to lose. Dispatch has **three** arms, in
order:

1. **Assets**, and they are TWO populations answered by one arm. The content-hashed client chunks
   and the css come from the build manifest (38.5), answered `public, max-age=31536000, immutable`
   (21.6) and precompressed with `vary: accept-encoding`. The `src/ui/public` files are listed in
   that same manifest (38.19) but answered `public, max-age=0, must-revalidate` with an `etag` and a
   304 on `if-none-match` (21.13, 21.14, 21.15) — D98 is why the year does not extend to them, the
   hash being what makes it safe. Both are `Bun.serve`'s own static route rather than a lane through
   the pipeline, which is what `answer-with-something-other-than-json.md:129` already tells app
   authors, and both cache-controls are generated by no other arm. Under `abide dev` it is the same
   `Bun.serve` — the chunks from the in-memory build (38.17, 38.18), the public files off the source
   tree (38.20) — served by the one process, there being no worker to own a second. A public path
   landing on a page route's address is a build error (36.14), so this arm shadowing arm 3 is
   caught before it runs.
2. **`startsWith(MOUNT + '__abide/')`** → `Map<'METHOD /address', Entry>`, an exact get. No matcher,
   because no address here carries a dynamic segment. `OPTIONS` on an address declaring
   `crossOrigin` is `preflight`'s (16.26) and never reaches the map.
3. **The page trie** — a segment trie where `[name]`, `[[name]]` and `[...name]` live (23.5), whose
   hit is "The page path" below.

37.2's `default` route is asked **before** all three, because that is what
`content/app/run-code-at-start-and-stop.md:67` promises, and it answers only where it returns a
`Response`; returning nothing means "did not answer" and dispatch continues. That is why the app
lane's context type in "The onion" is `Response | undefined` rather than `Response`.

**`/__abide/**` is not a reserved prefix, and no clause makes it one.** This plan previously cited
20.8 for it. 20.8 says only that every `/__abide/**` address runs inside the app's own middleware;
the word "reserved" appears nowhere in RULEBOOK or REGISTRY, and 19.2 makes a *collision* a build
error without saying an app may not mount there at all. The three-arm dispatch needs the reservation
— arm 2 shadows anything an app mounts under the prefix, silently — so it is **a new clause this
plan owes**, not a citation it has.

**Two structures rather than one, and Bun's own router is the alternative refused.** The vanilla arm
this whole budget is measured against uses it — `'/api/invoices/:id'` with `request.params.id` — so
the refusal has to be argued rather than assumed, in a project whose first goal is to use the Bun
API where there is one. Three reasons, and they are owed a DECISIONS entry: `[[name]]` optional and
`[...name]` catch-all have no spelling in Bun's matcher; `app.fetch(request)` must dispatch with no
`Bun.serve` in the picture at all, which is what 42.5's requestless answer needs; and exact
lookup and patterned match have different invariants, so widening either is how the rpc path
acquires a matcher it never needs.

A dispatch miss is `notFound()` (15.8), which `encode` answers at the refusal's own status like any
other.

## The onion

16.15 composes each entry's chain once at table construction, into links of `{ rung, next }`
capturing nothing per request (16.16) — a fixed shape like every other object on this path. Three
lanes, three context shapes, each composed once:

| Lane | Context | Clauses |
| --- | --- | --- |
| app | `{ request }` → `Response \| undefined` | 37.2, 37.3 |
| rpc | `{ request, args }` → `Value \| Failures` | 16.12, 16.13, 16.17 |
| socket | `SocketEvent` → `void` | 18.3, 18.4 |

The app lane answers `Response | undefined` and not `Response`, because 37.2's fall-through and a
completed `server.upgrade()` both return nothing and neither means 204. 16.33's
`undefined` → 204 is written over an `Rpc` and applies to the rpc lane alone; applying it at the one
exit to all three turns a hijacked socket into a 204 written onto a connection that is already gone.

16.22 has a throw escape the whole onion rather than unwind through it, so there is one `try`
outside the chain and never one per rung. That one `try` is where 37.5's `onError` runs — see
"Errors and faults", because the plan previously registered the hook in `hooks.ts` and never called
it. The socket lane is where D90 leaves the throw as the refusal, `SocketEvent` answering `void`
with no return channel to refuse through.

**The rung chain allocates a promise per rung per call, and that is the count the budget owes.**
D16 composed once to remove one *closure* per rung, and this plan inherited that number. But 16.13
requires the rungs to run on every call including in-process (D15), and an async chain allocates a
promise per link whether or not it captures anything. So `isThenable` guards `await next()` the same
way it guards the flush pump — CLAUDE.md's rule is about a value that is *usually already settled*,
and a rung that only reads `principal()` off a warm entry is exactly that. The two other paths where
the value is nearly always settled and this plan did not say so: `ctx.args()` after the first call,
and the seed re-attach, which is a settled value awaited through the full onion once per seeded read
on every hydration.

**Every one of those guards reads the brand FIRST — `isReactive(v)` ahead of `isThenable(v)`, per
1.5 and 1.7 — and the earlier draft of this plan wrote none of them that way.** 1.5 makes a
`Reactive` thenable and 1.7 has a load told apart from a value take the `Reactive` as a value, so a
bare `isThenable` test does not tell a promise from a live value: it awaits the `Reactive`, settles
it to one snapshot, and hands the snapshot on. The stream never happens, every test still passes,
and the page is right on first paint and dead afterwards. This is not hypothetical on this path —
the diagram at the top of this file has the in-process arm's production BE a `Reactive`, so it
arrives at `next()`, at the pump and at `encode` by construction. The guard is one `#shared` leaf,
imported by both seams and by the template slot in `RENDERER.md`; three implementations of a
two-line test is how one of them ends up in the wrong order.

**`ctx.args()` caches per call, not per request, and that is a correctness fix rather than a
preference.** 16.18 says "parse on first call and cache for the request", which is right for a wire
body and *wrong* for two in-process calls to one handler in one scope: an unkeyed per-request cache
hands the first read's args to the second, so a page rendering `getInvoice({ id: '1' })` and
`getInvoice({ id: '2' })` renders invoice 1 twice — and the seed then files one entry under two
keys D4 made comparable across sides. The parse is a property of the `Call`, so the cache is a field
on the `Call`. This plan previously carried it under "Still undecided"; it is not a caching
question, and **16.18 is owed an amendment**. It coerces from the `JsonSchema` before validating
(19.9, 19.10, D21), and 16.21 answers 400 on a body that will not parse. On an in-process call the
args arrived as values, so the parse is what is inert rather than the name.

`timeout` raises the request's idle timeout and only raises it (16.23), so the scope holds a floor
and each entry maxes into it (16.24) before reaching `server.timeout`. **Bun will not enforce the
raise-only half and does not bound a busy handler:** `srv.timeout(req, 1)` accepted a *lowering*
call without complaint and did not kill a handler that then slept 2.5 s, because Bun's per-request
timeout measures socket idleness rather than handler duration. So the `max`-into-the-floor mechanism
is load-bearing rather than defensive, and the 504 the docs promise is abide's — see "Cancellation
and teardown".

## The page path

Dispatch's third arm had no destination in the first draft of this plan: three onion lanes, none of
them pages, and eight stages that landed without ever serving one — in a framework whose dogfood is
a documentation site made of pages. This is that destination.

A trie hit resolves to a `page.abide` and the chain of `layout.abide` above it (23.3, 23.4). From
there:

* **The layouts compose into one bound `Component`**, which is the shape 35.4 requires `render` to
  take. 35.1 gives a layout a slot for its child and 35.2 has a layout resolved nearest-ancestor,
  so the chain falls out of the two — but **no clause states the ORDER**, and
  `content/pages/give-pages-the-same-chrome.md:32` promises outermost-first to users. A nesting
  order that only a content page states is a clause this plan owes. The chain is resolved **at
  table construction**, not per request — it is a property of the file tree (23.3), and resolving
  it per request is a walk up the trie on every page load for an answer that cannot have changed.
* **`route` and `online` are ambients on the scope like any other.** REGISTRY carries `route.url`,
  `route.params`, `route.name`, `route.navigating` and `online`, and
  `give-pages-the-same-chrome.md:52` has a layout read them with no prop drilling. They were absent
  from this plan's `Scope` and from its `ambient/*.ts` list, which is how a page path goes missing:
  the ambients it needs are not the ambients an rpc needs, and the plan was written from the rpc
  path outward.
* **The `Shell` is 35.6's, and it writes the mount.** What abide contributes to `src/ui/app.html` is
  the head merging (39.1–39.7), the mount meta and the bundle —
  `content/pages/render-a-document-yourself.md:52` states exactly that. `<meta name="abide-mount">`
  is written here, which matters because "Addresses and the mount" below depends on the browser
  reading it and this plan never said who put it there.
* **The production is `render`'s async generator**, so a page is an ordinary case for `flush` and
  for `encode`'s generator row. It is not a fourth lane; it is the app lane's downstream, wrapped by
  37.3's middleware like anything else.

35.2 and 35.3's error boundary is the render's rather than the runtime's, and "Errors and faults"
says where the two meet.

## Encoding

D91 made framing a table the chunk type indexes rather than a clause per framing, so `encode`
classifies once and the rest is a lookup:

| Returned | Answer | Clauses |
| --- | --- | --- |
| `Response` | copied, not passed through — see "One exit" | 16.39, 16.40 |
| `undefined`, rpc lane | 204 unless a status was written | 16.33 |
| `undefined`, app lane | did not answer; dispatch continues | 37.2 |
| `Failed` | its own status | 16.44 |
| a throw | 500, unnamed | 16.45, D75 |
| a mutation, request prefers `text/html` | 303 to the `Referer`; a `redirect` passes; a refusal **renders `error.abide`** at its own status | 16.42 |
| `Bun.file` | `application/octet-stream` or the file's own type, range-aware by the platform | 16.37, 16.38 |
| a plain `Blob` / `ArrayBuffer` | same content-type, **and `encode` owes the ranges itself** | 16.37, 16.38 |
| a `Reactive` | its production, negotiated as the generator row — **never awaited to a value** | 1.5, 1.7, 16.43 |
| async generator | negotiated among the framings the chunk type admits | 16.34, 16.50, 16.51 |
| over `maxBodySize`, declared | 413 before the body is read | 16.14 |
| over `maxBodySize`, streaming | bounded as it streams, cut off at 413 | 16.14 |
| `Origin` mismatch on a mutation | 403 before the handler runs | 36.2; the status itself is undeclared, per D13 |
| no progress for the floor | 504, an undeclared refusal | 16.23 |
| anything else | `application/json` | 16.32 |

The `Reactive` row is the fifth that was missing, and it is the one whose absence was dangerous
rather than incomplete. `COMPILER.md` spends one of its five type-directed sites deciding whether a
handler's return type carries a `Reactive` (16.43), and this table's only exits for the result were
the generator row and `application/json` — so a `Reactive` either fell through to JSON, or was
awaited by a bare `isThenable` on the way here and arrived as a snapshot. Both are silent: the
first page is right and nothing streams. The row is `encode`'s half of the guard-order rule above.

Four of the other rows were missing and each is one row of a table the plan otherwise wrote out in
full.
16.42 is the consequential one: **it makes `encode` a caller of `render`**, because a refusal on an
html-preferring mutation renders `error.abide` at the refusal's own status
(`content/server/change-something-on-the-server.md:126`). The one-exit design had no shape for that
and now has one — `faults.ts` owns the render call, `encode` owns the status and the headers.

**`Bun.file` is range-aware and a plain `Blob` is not, and `BunFile instanceof Blob` is `true`.**
Measured: `Range: bytes=0-99` against `Bun.file` answers 206 with `content-range: bytes 0-99/1000`
and `accept-ranges: bytes`; against a plain `Blob` it answers 200, the whole body, and no
`accept-ranges` at all. So an `encode` that classifies with one `instanceof` gets two behaviours and
a body-bytes test passes for both — the silent-work-difference class. Either `encode` implements
206 / `Content-Range` / `Accept-Ranges` / 416 for the non-`BunFile` arm, which is machinery this
plan has not budgeted, or it answers 200 **without** `accept-ranges` so the absence is stated on the
wire rather than implied. **16.38 is owed the distinction either way**; it currently reads as though
one rule covers both.

`cache-control` is derived here, 21.9's `max-age` from a `global` memo's `ttl` included — which is
only legal because D7 made a request-scoped read inside a `global` body a build error rather than
advice, and 21.10 is the clause requiring `private` beside it (D72 is why). 21.6's `immutable` is
the asset route's and not `encode`'s at all.

`vary` (21.8) is written by whatever performed a negotiation rather than by a list `encode` keeps,
so a header the answer depended on cannot be named in one place and forgotten in the other. **The
set is closed** — `origin`, `accept`, `accept-encoding`, and never `traceparent`
(`content/server/let-another-origin-call-you.md:67`) — and saying so is the difference between an
elegant mechanism and header injection, because the one header written from outside the single exit
is the one whose names must not come from a request.

`new Response(body, { status: 204 })` does **not** throw in Bun 1.4.0, contrary to the spec, and the
same holds for 205 and 304. The wire is right — the body is dropped and the generated headers
survive — but the constructor will not catch a handler that wrote a status *and* returned a value,
so if 16.33 wants that to be an error, `encode` raises it.

### The flush

D92 is the constraint that shapes the pump: response headers precede the body, so a framing read
off the first chunk holds every header until that chunk exists, and the streams most worth
streaming are the ones whose first chunk is slowest. So headers go the moment the framing is known,
and `jsonl`, `sse` and `bytes` (17.10) exist for when the chunk type is what is late — at the price
17.11 names. Measured end to end: headers at 0.8 ms with `x-framing` set, chunks at 1.0, 61.4 and
122.5 ms. The mechanism works.

The pump is one adapter from the async generator `render` produces (35.5) to a `ReadableStream`,
batching by **flush** rather than by production (35.10, D37), emitting the `<head>` as soon as it
is known (41.1), continuing past a sink (41.4), and waiting on a blocking sink for that flush alone
rather than for document generation (41.5). `isReactive` then `isThenable` guards every await in it,
in that order (1.5, 1.7): a chunk already settled must not buy a promise wrap and a microtask tick
per row, and a `Reactive` reaching the pump must not be awaited into a snapshot of itself.

**It is a pull-based `ReadableStream`, and naming the kind is load-bearing.** Bun's
`type: 'direct'` stream is the faster sink and the one a hot pump reaches for, and it has **no
backpressure at all** — measured, same server and same slow client: the pull-based stream throttled
its producer to 22 of 5000 chunks while the direct stream ran all 5000 to completion, buffering
312 MiB against a client that had read 800 KiB. So backpressure is a property of this choice rather
than of the transport, and the trade goes on the record here rather than being discovered at
stage 4.

**Once the first chunk is out, headers and status are spent, and Bun says nothing.** Measured:
`headers.set()` after the send neither throws nor takes effect — the header simply never reaches the
client — the status is fixed at construction with no late channel, and `Response.prototype.trailers`
does not exist. That collides with 22.11's `response` ambient, which hands back the response being
built: a handler writing `response.status(500)` while generating chunk 5 gets a silent no-op, which
is the output-stays-right-while-the-work-goes-wrong class a correctness test cannot catch. So
`response` throws past the cutoff, naming it, and **that is a clause this plan owes.**

It also makes 26.22 bite far harder than it did. `principal.set` must throw once the response
headers are out — and D92 is this plan's own reason for getting them out as early as possible, so a
`principal.set` inside a streaming page handler now throws where a late-headers design would have
let it work. That is a real cost of D92, it is not written down anywhere, and the repair is either
a documented ordering rule for page handlers or a deliberate hold on the `set-cookie` header alone.

## Errors and faults

The first draft of this plan accounted for failure in one table row — a throw is 500, unnamed — and
`onError` and `error.abide` appeared in it zero times. Four things happen on a fault and they happen
in different places:

* **37.5's `onError` runs inside the one `try` outside the onion**, in the scope that failed, before
  `encode` sees anything. Registering it in `hooks.ts` and never calling it is how a hook documented
  to users (`content/pages/show-a-page-when-something-fails.md:56`) becomes inert.
* **35.2 and 35.3's error boundary is the render's**, resolved nearest-ancestor, escalating past its
  own boundary and warning on `abide:render`. The runtime's `try` sees only what escapes the
  outermost boundary.
* **16.42's html navigation** turns a refusal into a rendered `error.abide` at the refusal's own
  status, which is the `encode`-calls-`render` edge above.
* **A throw after the first chunk has flushed has no status left to spend.** D92 bought the early
  headers and this is the bill: the response is already 200, the framing is already declared, and
  the only honest answers are to end the stream and log on `abide:render`, or to emit a
  framing-appropriate terminal frame — sse has `event: reset` (16.53, 16.54) and jsonl has an
  envelope (16.52), and `bytes` has neither. **Which of those, per framing, is undecided** and is in
  the list below.

The same goes for a throw from a disposer (12.7 warns on `abide:watch`), from `onStart` or `onStop`
(37.6, fail hard), and for an unhandled rejection with no scope to attribute it to.

## Cancellation and teardown

`abort`, `signal` and `disconnect` appeared zero times in the first draft, and two of its own
mechanisms depend on them.

**`request.signal` is what tears the scope down.** A client that disconnects mid-stream, a request
that exceeds the floor, and a normal completion all reach the same path: run the disposer list once
(12.6), release the sinks, and drop the scope. The work gate below asserts exactly-once, and until
something *fires* it, the gate asserts a path nothing walks.

**The room-drop gate is unreachable without it.** D93 has the client read a room over `fetch`/jsonl,
so the only thing that ever unsubscribes is the stream being cancelled when the client goes away.
`flush` therefore reacts to `ReadableStream`'s `cancel` and to `request.signal`, and that is what
makes 9.17's last-unsubscribe-drops-the-room observable at all. A gate that cannot fire is worse
than no gate.

**The timeout fires something, and it is a 504.** 16.23's floor is measured **per chunk** on a
yielding handler and refuses at 504 with `name: 'HttpError'` and no data
(`content/server/put-a-ceiling-on-a-request.md:26`, `:50`). `ABIDE_RPC_TIMEOUT` is the default. This
plan read 16.23 as the idle-timeout raise alone and never produced the refusal — which, combined
with the measurement above that `server.timeout` does not bound a busy handler, means nothing in the
first draft would have cut anything off.

## The seed buffer

D39 decides the shape and it is not the obvious one: the answers are **not** embedded in the
document, the round trip is still made, and only the handler's work is saved — the buffer lives on
the server and is released on a timer.

The reading that makes every clause fall out rather than be implemented: **the seed buffer is the
render scope's memo entries, encoded to the chunk type's default framing (16.36) at the production,
given a TTL, and re-attached to the requests carrying its id.**

* 41.14 and D94 — the entry *is* the render's production, so there is no refill, no second rung
  pass and no window in which the answer and the page can disagree.
* 41.8 — a client call carrying the seed id is answered from the entry **in place of the handler
  body**, at the innermost position in the onion, so 16.12's rungs still run and a seeded answer is
  not the one call in the app that nothing guards.
* 41.13 and D73 — a miss is literally "the key the client computed is not one the render computed",
  and D4 is what makes those keys comparable across the two sides.
* D54's discipline — one timer over the earliest expiry, never one per production.

### 16.14 blocks this, and the repair is two members and a new condition

16.14 lists "the seed buffer write" among the wire-only steps. A render-time read is an in-process
call (16.4, D17), so under the clause as written the write never happens, the buffer is provably
always empty, and:

* the handler runs **twice** for every seeded read on every first page load — the query, and 16.12's
  authorization, rate limit and logging with it. This is the cost D94 refused, arrived at by
  omission rather than by the refill it was arguing against;
* every hydration read misses, so 41.11 fires on every block on every first load and
  `abide:hydrate` warns per read. The one diagnostic that says "the client took a path the server
  did not" is buried under a page's worth of noise, per load;
* BRAND's "Reading loads it" claim rests on 16.36 — *the browser's read is answered by what the
  render already fetched* — and BRAND's own preamble makes that a commitment, stale the moment the
  rule moves. It is stale today;
* nothing catches any of it. Every page still renders and every value still arrives.

Six of 16.14's seven members are conditions on the **call**. The seventh is a condition on the
**scope**, and it must fire on exactly the in-process call the other six exclude. (Member four,
"the framing", is argued below to be a condition on the call after all; the count of six holds
either way, because that argument is what keeps it there.)

Striking it dangles nothing, but it does not leave everything standing either. `grep -rn '16\.14'
docs/` returns five citing sites outside this file, not four:

* three REGISTRY rows — `maxBodySize`, `response`, `ABIDE_MAX_REQUEST_BODY_SIZE` — none about the
  seed;
* one sentence of D89, not on D89's `Assumes:` line;
* **`docs/DECISIONS.md:1681` — D99's `Assumes: 16.4, 16.12, 16.14`.** This one is not fine. D99 is
  "A test holds the app, not a client of its own", and its argument is that *what a test reaches
  for a client for is the steps a wire adds, and `App.fetch` runs those steps rather than standing
  in for them*. "The steps a wire adds" IS 16.14's list. Strike a member and D99 goes on reading as
  valid with its reason quietly one member smaller — nothing contradicts it, and only its premise
  moved. That is D3's shape exactly, and the earlier draft of this paragraph checked D89's
  `Assumes:` line and inferred the rest, which is how it was missed. D99 needs re-reading, and its
  entry amended to name the scope condition, in the same change.

**But one member is not the whole repair, and this plan previously said it was.** Two further
things:

* **16.14 also makes "the framing" wire-only**, and 16.36 requires the seed entry to hold the
  transcript in the chunk type's default framing — work performed at the production, on the
  in-process call the clause excludes. Either 16.14's "the framing" means the `Accept` negotiation
  alone (which is how D91 and D92 both read, and how 16.36's "whichever framing the caller asked
  for" reads) or the seed cannot encode a stream at all. The amendment says which. Left unsaid, a
  later session lands the one-member strike verbatim and the seed silently covers scalars only.
* **Striking a member removes a condition and adds none.** "41.14 already states when the buffer is
  filled" is not true as relied on: 41.14 states what it is filled *from*. After the strike, a seed
  entry is written on every in-process call in every scope — an `abide run` job, a handler calling
  another handler during an ordinary wire request — into the store whose bound is still undecided.
  The replacement condition is **"the scope is a render"**, and it is a new clause rather than a
  consequence of an existing one.

**The amendments land before this stage does.**

### The seed id is a bearer capability

The id addresses a server-side buffer holding another visitor's already-computed answers, and 41.8
answers from it *in place of the handler body*. The rungs still run, which is the authorisation
answer and it is a good one — but the id itself is the thing an attacker guesses, and this plan's
open questions covered its *spelling* and the store's *bound* while saying nothing about entropy,
generation, or binding. Under D26 this is the one piece of server-side per-visitor state in a design
that is otherwise stateless, so it is exactly where a capability check is owed: the id is
cryptographically random, and an entry is bound to the visitor that created it and refused to any
other.

**`principal.caller` is the wrong thing to bind to, and the earlier draft of this paragraph bound to
it.** 26.5 has `principal.caller` "read off its own cookie or minted, and MUST need no resolution" —
it is unsealed and client-settable, and 26.12's HMAC covers the principal's claims, not the caller.
An attacker holding a guessed id sets the cookie to whatever the entry names and the binding refuses
no one. A capability check that the attacker supplies the input to is not a check. The binding is to
the **sealed** principal, or the caller cookie is sealed first and 26.5 amended to say so; the
amendment is owed either way and this plan does not decide which.

Three further things the clause needs before it can be written, none of which is a detail:

* **Entropy, stated.** "Cryptographically random" is unfalsifiable as a clause. 128 bits from
  `crypto.getRandomValues`, base64url, is the spelling — a number a test can assert and a reviewer
  can reject.
* **A lifetime.** The TTL and the store's bound are on "Still undecided" below, so the capability's
  window is currently undecided too. A bearer token with an undecided lifetime is not a design.
* **A read cap.** Nothing here stops one id being replayed for the whole TTL. One read per entry
  per seeded block — the client reads each block exactly once on hydration — makes the id single-use
  and takes replay off the table without another mechanism.

The cookie spelling still open below compounds all three: keyed per visitor rather than per render,
one tab's seed answers another tab's hydration. **This clause does not land as drafted.**

## Rooms and the socket mux

18.2 puts every `Socket` over a single mux, so `ws.data` is one fixed-shape record per connection —
the room-subscription set is allocated at construction with the record, and it is the set's
*contents* that vary, never the record's shape. Rooms are the reactive core's channel entries (9.18
makes them process-wide) and D64 has the last unsubscribe drop the room (9.17), so the runtime holds
no room table of its own — the second half of "no storage of its own", and see "Cancellation and
teardown" for what actually triggers the unsubscribe.

**There is no per-connection send queue.** 18.13 has a reconnect carry its last sequence number
(and 16.54's `Last-Event-ID` is what carries it on the sse arm), 18.14 and 18.15 handle a moved
epoch, and D68 already made the ring the window's buffer. So a backpressured socket drops and the
client resumes from what retention still holds. A queue would be a second retention with no option
naming it, which is what D68 refused one level down.

D93 decided the client reads a room over `fetch` on both lanes, so the http arm is jsonl carrying
the same envelope (16.52) rather than a second protocol, and 16.53's and 16.54's `id:` and
`event: reset` are a courtesy to a hand-written `EventSource` rather than the path abide's own
client takes.

## Logs, and the runtime as their largest producer

28.1 makes `log.records` an ordinary `Room`, which is why the first draft gave `logs` one word in a
table. That is right about the *surface* and wrong about the *producer*: **the runtime writes
`abide:request` once per request and `abide:socket` once per socket event**, plus `abide:lifecycle`,
`abide:principal`, `abide:health`, `abide:config`, `abide:render` and `abide:refuse`. A publish per
request is a per-request allocation on the hot path and it was not in the cost table.

So `log.ts` is a module rather than a surface, 28.6's `log.enabled` gate is checked **before** the
record is built rather than after (an unwatched `abide:request` should allocate nothing), 28.10's
`DEBUG` grammar decides it, and 36.8's `ABIDE_LOG_FORMAT`, 36.10's `NO_COLOR`-beats-`FORCE_COLOR`
and `ABIDE_MAX_LOG_BUFFER_COUNT` as the room's `tail` are the rest of it.

**One tension this plan is uniquely placed to catch and did not.** The work gate below asserts a
room's last unsubscribe drops the entry (9.17). Applied to `log.records`, the ring is discarded
whenever nobody is watching — while `content/app/record-what-happened.md:113` promises a memory ring
"bounded, and gone when the process is", and `abide logs` is `abide call` on it *after the fact*.
9.15 and 9.17 against a room the process publishes to unconditionally is a real conflict, and the
resolution — a room with a `tail` survives its last reader, or `log.records` is not an ordinary room
— is undecided.

## `principal`, past the resolve

`principal` is a request-local memo whose body is the resolve, so 26.15's at-most-once and 26.2's
shared resolve are 11.40 rather than machinery. That covers the resolve and nothing else, and the
first draft stopped there — leaving every security-bearing part of 26.x with no module and no stage:

* **26.12** — HMAC over claims and expiry, signed and not encrypted; **36.5** —
  `ABIDE_PRINCIPAL_SECRET` is a **comma-separated list**, which is key rotation: verify against
  all, sign with the first.
* **26.13** and **22.4** — `HttpOnly`, `SameSite=Lax`, `Secure` in production, with `secure`
  defaulting from `NODE_ENV`; **26.19**, **26.20** — the two cookie names; `ABIDE_PRINCIPAL_TTL`.
* **26.16** — refresh once half spent, which is a *write* on a read path and therefore interacts
  with 22.3's cookie collection and with 26.22's cutoff above.
* **26.14** — bad signature, lapsed and malformed all collapse to anonymous.
* **26.5–26.9** — the `abide-caller` mint, the survive-set, and rotate-on-clear.

## The preflight, and a content page resting on a withdrawn clause

16.26 requires abide to answer the `OPTIONS` preflight itself where `crossOrigin` is declared. The
exact-map dispatch has no entry for an `OPTIONS`, so without arm 2's carve-out it falls to
`notFound()` — which is *correct* for an address with no `crossOrigin` and wrong for one with it.
The answer is specified in content already
(`content/server/let-another-origin-call-you.md:36`): `access-control-allow-origin` echoed,
`-allow-methods` singular, `-allow-headers` echoed, `-allow-credentials: true`, `-max-age`, and
`vary: origin, access-control-request-headers`. **`access-control-max-age` has no number anywhere in
the four documents** and is owed one.

And a finding that belongs to nobody else: that page justifies answering the preflight outside
middleware "for the same reason `/__abide/health` is". **That reason is dead** — 25.2 is withdrawn
and D62 refuses exactly that exemption, deciding 20.8. This plan cites 20.8 and D62 approvingly and
did not notice a content page claiming a second lane on a premise that no longer holds. It is the
resolves-but-drifted case, live in the docs today, and it is owed a content fix rather than a
clause.

18.5's socket `crossOrigin` and the documented fallback where `APP_URL` is unset — the upgrade check
comparing against the request's own `Host`, self-described as the weaker answer — are the same
mechanism one lane over, and widening 36.2 for the mount below must not quietly move them.

## The host, and how a test loads the app

Three layers. The middle one is the only thing an app, a host or a test ever holds.

| Layer | Owns | Knows about |
| --- | --- | --- |
| host — `abide start`, `abide dev`'s main thread | the process, the stable port, the reload swap | nothing about the app |
| `App` — `createApp()` | tables, onions, rooms, seed store, hooks | nothing about a port |
| `Scope` | ambients, request-local entries, sinks, disposers | nothing about either |

```ts
const app = await createApp(options?)  // app.ts, config, tables, onions, onStart (37.4)
app.fetch(request)                     // the whole request path → Response
app.run(fn, { request? })              // just a scope; fn's return value comes back
await app.listen({ port })             // binds; supplies server()
await app.stop()                       // drain, onStop (37.4), failing hard per 37.6
```

`fetch` is `run` plus dispatch and encode, so there is **one scope constructor and two entries over
it**. `listen` supplies the socket and nothing else.

**`config` is read at boot, not lazily.** `content/ship/build-and-serve-the-app.md:45` promises
"validated at start, so a misconfigured deployment fails to come up rather than at the first
request" — and a `global` memo (27.10) loads on first *read*, so `createApp` forces the read. That
is what turns 27.2 (`config` throws what `onConfig` threw), 27.8 (the schema checked last over the
whole document) and 37.6 (fail hard, do not start) into the promised behaviour rather than a
first-request 500.

**`stop()` drains.** `content/app/run-code-at-start-and-stop.md:48` is explicit: `await stop()`
first, *then* tear down what you opened, "so a connection is closed after the last request that
could have used it, not during". So `stop` stops accepting, waits for in-flight requests, ends live
streams, closes sockets, runs `onStop`, **and clears the `SeedStore` timer** — which the first draft
never cleared, and a test file that calls `createApp()` and never stops it then holds a live timer.
CLAUDE.md's own note applies: a suite that hangs reports nothing at all.

**Two `createApp()` in one process share more than the plan said.** Rooms are process-wide by 9.18,
`config` is a `global` memo, and 11.36 puts `global` entries in a process-wide cache that outlives
every request. So two apps in one test file share rooms, share config and share the global memo
cache — which is fine, and is the answer to "which n" in the `global` work gate below, but it has to
be *stated*, because the test story invites exactly this.

### `server()` where there is no socket

This is **undecided**, and the first draft decided it three ways in three places: stated as settled
("throws, naming `listen`"), listed under "Still undecided", and drafted into an owed clause that
made `server` a property of the *wire* — which would license `server()` in exactly the
`app.fetch`-without-`listen` scope the settled sentence says throws.

The citation does not settle it either. 22.1 reads "`request`, `response` and `server` MUST throw
**outside a request**", and `app.run(fn, { request })` is *inside* one, so 22.1 is silent here and
this would be new behaviour called existing. 23.7 and 23.8 cut the other way from how they were
cited: they are the *inert-answer* case — `online` is `navigator.onLine` in a browser and `true` on
a server — so they are precedent for the stub, not against it. Only D83 carries the throw side, and
D83 is about a *value that reads as absent inviting a fallback*, which is a different failure than
an inert *handle*.

CLAUDE.md's uniformity bias points at the inert `Server`-shaped stub, and this plan uses that shape
one page earlier for 16.14's wire-only steps without saying why the two cases differ. **Whichever
way it goes, it is a clause, a REGISTRY note on `server`'s row and a DECISIONS entry**, and 22.1 is
in the amendment list below. In practice the case is rare — `timeout` is a handler option (16.23),
rooms belong to the mux (18.2), upgrades to the socket lane (18.3).

`app.run(fn)` with no request is a scope with no wire, where `request`, `response` and `cookies` all
throw by 22.1 and 22.10 — that rule *is* already written, and it is the case 22.1 covers. That is
`abide run`, a job, and a test calling handlers directly. 16.27 makes calling a request-bound
handler from such a scope a build error via 11.39 — **but that is a static refusal nobody has
built**: this plan gives both scope shapes to one runtime function with the request an optional
argument, and 16.27 is absent from `COMPILER.md`'s enumerated static refusals. Either COMPILER.md
takes it or the failure is a runtime throw inside a job, and the plan should not cite a gate that
does not exist.

**One consequence to state out loud:** `onStart` wraps `createApp`, not `listen`, so a hook cannot
observe the port. Boot is the app becoming able to answer; binding a socket is `listen`'s. 37.4 says
the hooks wrap "the real boot", and this decides what that is — so it is a clause, not an aside.

This survives the worker's withdrawal but its ARGUMENT does not, and D100 is where that has to be
repaired rather than here — see the amendment ledger. The reason as written leans on the dev host
owning a port the app never chose; with one process there is no such host, and what is left is that
`createApp` is where the tables, the onions and `config` land, and that 42.5 has `App.fetch` answer
where nothing is bound. The conclusion is the same and it now rests on one leg.

### A test loads the app and calls it

```ts
const app = await createApp()

const answer = await app.fetch(
    new Request('http://app.invalid/__abide/rpc/invoices/getInvoice?id=42'),
)
expect(answer.headers.get('traceresponse')).not.toBeNull()  // 21.2, on every answer

// 11.40 — two reads of one key in one scope share one load. A second scope loads again.
const loads = await app.run(async () => {
    await Promise.all([getInvoice({ id: '42' }), getInvoice({ id: '42' })])
    return database.invoice.find.calls
}, { request })
```

No port, so no contention under `--parallel` — which matters, given the routing suite and the
shared `.abide/client` already on record in CLAUDE.md. A test that needs `server()` or a real
`WebSocket` calls `app.listen({ port: 0 })`; measured, two concurrent servers took distinct
ephemeral ports, so the argument holds.

**The motivating failure this plan used to cite is not one.** It read `served.test.ts`'s
`Bun.serve` stub as something separating `createApp` from `listen` would remove. It would not:
`routesOf()` stubs `Bun.serve` to import the hand-written **vanilla** arms, which call it at top
level whatever shape `abide/server` takes — the file's own comment says so ("the file is real Bun
code and calls it at the top level"). The split stands on the no-port argument alone, and the owed
DECISIONS entry must not record a premise that was never true, which is precisely what an
`Assumes:` line exists to catch.

### The dev split, and why there is not one

38.15 puts the app in a worker and the listener on the main thread, and 38.16 is the reason: a
listener inside the worker would drop the port on every reload, refusing connections through the
swap. **This plan refuses the worker, and asks for both clauses to be rewritten.**

The argument is what the worker actually buys, which is less than the split implies. 38.16 already
force-closes every live socket on reload, so the worker never preserved sockets. It preserves
exactly two things — the listening port across a swap, and in-flight HTTP requests — and it charges
four divergences from the project goal "maintain a consistent runtime between all builds and
environments" to do it:

* `server.requestIP()` returns `null` over a unix socket. Measured: `{"ip":null}` against
  `{"ip":{"address":"::1",…}}` over tcp. Not a wrong value inviting a fallback — a **crash class**,
  since anything doing `server.requestIP(req).address` works in production and throws `TypeError`
  under `abide dev`.
* Websockets do not proxy through `fetch`, and forwarding blindly leaks one live server-side socket
  per upgrade attempt with no client on the other end. Measured: the worker's `srv.upgrade(req)`
  returns `true` and the socket opens while the host's `fetch()` never resolves.
* An app's own `default` route (37.2) calling `server.upgrade()` by hand does not reach the host's
  connection — a silent behavioural difference with no diagnostic.
* In-flight requests are held through a swap rather than refused.

Four exceptions in one mechanism is CLAUDE.md's "the mechanism is wrong, not that a fourth is due",
and the deepening that would absorb them — naming the thing that owns the client connection, so
`server` is a handle on it and the direct and relayed cases are two implementations of one
interface — is machinery built to carry exceptions that do not have to exist.

**Restart the process on change. There is no worker, no host, no relay, and no dev-only asymmetry
of any kind.** `server` is `Bun.serve`. `requestIP()` returns the peer. A hand-written
`server.upgrade()` reaches the real connection. The consistent-runtime goal stops being approximate.

What it costs is the two things the worker bought. In-flight requests are refused rather than
drained, and there is a window where connections are refused — measured at **8-11 ms** to
boot a process and bind, five runs, which is the floor for a trivial script rather than for a real
graph. Sockets drop either way, per 38.16. The reload client 38.18 already requires is what covers
the window, and it is already in the page.

**The alternative that keeps in-flight requests, and why it is not taken.** `Bun.serve()` swaps its
handler on a live server — probed, the port is stable across `server.reload({ fetch })` and the
answer moves from the old graph to the new. That gets both of the worker's prizes in one process.
It fails on the module graph: a plain re-import is cached, so a fresh graph needs
`import('./app.ts?v=N')`, and the registry then **pins every version**. Probed: RSS 20 MiB at start,
179 MiB after 40 cache-busted 4 MiB graphs, and `Bun.gc(true)` reclaims none of it. Linear and
unreclaimed, against an n that is however many times the file is saved in a session. The per-graph
figure is a synthetic module and a real graph differs; the shape is the finding.

It also loses the clean slate. `onStart`/`onStop` recover the declared lifecycle, but a stray
`setInterval` or a module-level global from the old graph survives into the new one — a class of
dev-only misbehaviour that cannot happen in production, which is the expensive kind to debug. An
unbounded leak and a dirty slate against a bounded, visible window that the reload client already
handles: the window is the cheaper failure, and it is the only one of the three that has a floor.

## Addresses and the mount

Four content pages state that `rpc.url` and `url` resolve against `<meta name="abide-mount">` in a
browser and `config().APP_URL` on a server — `server/find-the-url-a-handler-answers-on.md`,
`pages/serve-the-app-under-a-sub-path.md`, `reference/helpers.md` and
`ship/build-and-serve-the-app.md`. **No clause says it.** 16.11 says `rpc.url` must resolve a
*mount-relative* address at run time — so it does name the mount; what it leaves open is what
supplies the mount's value. 30.1 says `url` builds from a route literal; 36.2 gives `APP_URL` one
job, being what both origin gates compare against. `<meta name="abide-mount">` appears nowhere in
the four decided documents.

**`new URL` is the wrong mechanism.** Three of its four spellings silently drop a sub-path, verified
row by row:

```
/__abide/rpc/x  |  https://example.com/docs   ->  https://example.com/__abide/rpc/x    ✗
/__abide/rpc/x  |  https://example.com/docs/  ->  https://example.com/__abide/rpc/x    ✗
__abide/rpc/x   |  https://example.com/docs   ->  https://example.com/__abide/rpc/x    ✗
__abide/rpc/x   |  https://example.com/docs/  ->  https://example.com/docs/__abide/rpc/x  ✓
no base         |  (APP_URL is null)          ->  TypeError: Invalid URL   — both spellings
```

It works only where the address carries no leading slash *and* the base carries a trailing one, and
`APP_URL=https://example.com/docs` is how the value is written.

So: **the mount is resolved once per process into a prefix, and `url()` is a concatenation.** `new
URL` runs once on the server to take `APP_URL`'s pathname; the browser reads the same path from the
`<meta>` the `Shell` writes. A null `APP_URL` is the prefix `/`.

**The correctness argument is the whole argument, and the perf argument does not survive its own
measurement.** The first draft also called this a hot path — a `URL` parsed per item inside a
`{#for}`. The ratio is real: concatenation 21.6 ns/op against `new URL(rel, base).toString()` at
169.0 ns, **7.8x**, one `URL` allocation per row. But the delta is 73.7 µs over a 500-row list,
which is **0.44% of one frame**, and the n at which it crosses a frame is **113,000 rows**. Against
CLAUDE.md's own 2.8 µs for moving an element with its subtree, the parse is ~6% of a row's work.
That is the unmeasured-share pattern CLAUDE.md records as having sunk two reactive-core rewrites,
and it would have ridden in on the correctness argument's back and become the reason people
remember. **The DECISIONS entry refuses `new URL` for the silent sub-path drop alone.** The gate
below stays, because it is cheap and holds a real invariant — but it is filed as an invariant, not
as a cost.

**The prefix is a path on both sides, not a URL on one.** If the server resolved to
`https://example.com/docs/` while the browser resolved to `/docs/`, every `href`, `src` and `<form
action>` rendered on the server would differ from what 41.7 re-executes — a 41.11 mismatch on
essentially every page, silent because the page still works. Absolute is a separate job, wanted
only where the address leaves the app: a webhook registration, an email, `og:url`, a canonical
link, OpenAPI `servers`, an MCP resource URI. Every one is server-side and outside a request, so
there is no isomorphism to preserve — and `abide openapi [--url <origin>]` and
`abide mcp [--url <origin>]` already treat the origin as supplied rather than ambient.

**The correctness gate for this already exists in the repo and this plan did not name it.**
`playwright.config.ts:3-4` carries the comment — "Two projects over the ONE app: served at the
root, and again under a sub-path. The sub-path arm is what catches a URL the framework built by
assuming '/'" — and `:16` is where the two projects are declared. CLAUDE.md's rule — the
distinguishing case for COST and for CORRECTNESS are different cases and both are owed — lands
exactly here. `packages/dogfood/e2e/` is empty, so the spec does not exist yet and is owed at
stage 2, not at the end.

## `config` on both sides

Abide already carries two config values to a browser, each with its own spelling: the mount through
`<meta name="abide-mount">`, and `DEBUG` through the document by 28.11. Neither can move to an
endpoint, and the reason is circular in both cases — **the mount is what addresses the endpoint**,
and `DEBUG` must be readable before the first log line, which is before any fetch resolves. That
there are exactly two, and that both are abide's own, is worth a clause: it stops the
document-carried set growing by habit.

Everything else is a fourth member of an existing family. `principal` and `health` are ambients
that reach a browser as **seeded rpcs** (25.5, 26.18) at `/__abide/*`, inside the app's middleware
(20.8, D62), `no-store` (21.5). `config` at `/__abide/config` is that shape exactly, and inherits
all of it — including giving 27.6 a meaning in a browser, where "re-reads the environment and
re-runs `onConfig`" describes nothing and a memo behind an address re-fetches. **21.5 enumerates two
addresses and needs widening to three**, and REGISTRY's generated-headers row mirrors the same
enumeration; without that, the new address's cache behaviour is covered by no clause.

```ts
onConfig((env) => ({ … }), {
    schema: …,
    public: ['APP_NAME', 'APP_VERSION', 'STRIPE_PUBLISHABLE_KEY'],
})
```

**An allowlist, never a denylist and never a prefix convention.** `Config` merges `Env`, which is
the whole process environment — `ABIDE_PRINCIPAL_SECRET` included — so the option enumerates keys
and the endpoint serves exactly those. **Declaring keys is the opt-in**, so no fourth `ABIDE_*`
flag: an absent list means the address is not declared and 15.8 answers it, by analogy with 16.8's
declaration-as-authorisation rather than as a pattern 16.8 already carries.

The honest counter-argument, stated so the machinery is budgeted rather than assumed: an app can
write this today as `GET(memo(() => ({ stripeKey: config().STRIPE_PUBLISHABLE_KEY })))` and get
seeding, probes, refresh and four surfaces free. What the option buys is the project goal as
written — *same callable, same name, same intent on both sides* — and the observation that `config`
is the only ambient that could answer on both sides and does not, where `request`, `response`,
`server` and `csp.nonce` throw because they genuinely cannot.

**The type is the hard part, and it is not settled here.** A browser reading a non-public key would
get `undefined`, which is the silent absence D83 argues against. Three repairs, each costing
something real: narrowing `config()`'s type in a `#ui` context is a **sixth** type-directed site
against `COMPILER.md`'s closed list of five; throwing on a non-public key needs a `Proxy`, so a
per-read cost on a name read in templates; a second declaration-merged interface beside `Config` is
the second artifact teaching a type what the `public` list already says, which is what D88 refused
for `Bag`. Isomorphic-with-a-silently-undefined-key is worse than server-only, so **stage 7 does not
start until one of the three is chosen** — and that gate is now recorded in the stage list rather
than only here.

## What it costs

Against the hand-written arm at `packages/dogfood/examples/read-invoice/vanilla/server.ts` — eleven
lines, `Bun.serve({ routes })`, `Response.json`, a `404` written inline.

CLAUDE.md budgets machinery in three numbers and the first draft of this table reported one — the
flattering one. All three are here, and the one that was reported is the one that reads near zero.

| | vanilla | runtime |
| --- | --- | --- |
| **LOC over vanilla** | 11 | **owed at stage 0, not stage 3** — the vanilla arm is what justifies the machinery, so measuring after `Scope`, the ambients, both tables and the onion have landed makes it a report rather than a gate |
| **Public names added to `abide/server`** | — | `createApp`, `App.fetch`, `App.run`, `App.listen`, `App.stop`, `ConfigOptions.public`, and the ambients REGISTRY already carries — **seven**, against the "one" the first draft claimed, and the owed-REGISTRY list below is where the number comes from |
| **Branches added to a shared path** | 1 (the `404`) | the `call.wire` test on six of 16.14's members, three dispatch arms, three onion lanes, thirteen `encode` rows, two `Blob` arms, one framing switch — **a target rather than a count until it lands**, and the number to hold down |
| Response construction sites | 2 (the 404 and the JSON) | 1 in `encode`, plus the asset route in front of the pipeline |
| Closures per call, n rungs | n/a | 0 — composed once (16.15) |
| Promises per call, n rungs | 1 | **n**, one per link, unless `isThenable` guards `next()` |
| Allocations per request | see below | see below |
| Async context lookups per ambient read | 0 | 1 `getStore()`, measured at 2.9 ns — 0.0087% of a request |
| What it buys | — | ambients, one call path both arms, the seed, the page path, four surfaces, one header pass |

### Allocations, actually counted

The first draft said four — `Scope`, `Call`, `Response`, `Headers` — and nominated it as one of "the
two numbers to defend or shrink". It is wrong in both columns and in opposite directions. Counted
with `bun:jsc`'s `heapStats().objectTypeCounts` around `fullGC()`, 2000 reps, on a path **simpler**
than this design (no onion, no coercion, no schema):

```
Object:6.09  Array:4  string:3.01  JSLexicalEnvironment:2  Promise:2
Function:1.01  AsyncFunction:1  Map:1  AsyncFunctionGenerator:1
Headers:1  Response:1  URL:1  URLSearchParams Iterator:1  URLSearchParams:1
```

**~24 heap objects, not four.** The isolates say where they come from:

| | measured |
| --- | --- |
| `new URL(req.url)` for dispatch | `URL:1` — never named in the first draft |
| the args parse (`Object.fromEntries(searchParams)`) | `Object:3.09 string:2 Array:1 URLSearchParams:1` + iterator — six, never named |
| `als.run(scope, asyncFn)` over the bare async call | `Array:3 Object:1.09 Function:1 Map:1` — **six**, and the first draft budgeted `AsyncLocalStorage` as a `getStore()` lookup only |
| `Scope`'s own fields | `Map:1` (11.34's entry map) `Array:1` (12.6's disposers), and three more collections the fixed-shape rule makes eager |
| `Response.json({…})` | `Object:1.09 Response:1` |

Two notes for whoever writes the gate. `Headers` **is** allocated, but not because a `Response`
allocates one — `new Response("hi")` is `Response:1` alone, and the JS wrapper is materialised on
the `.headers` *read*. It costs 1 only because 21.1 and 21.2 force `encode` to read and set. And
**JSC counts a plain class instance as `Object`**, so `Scope` and `Call` never appear under their
own names and a gate written against `objectTypeCounts.Scope` reads 0 forever.

The vanilla column has the same problem in reverse: `Response.json(invoice)` allocates a `Response`,
a `Headers` and a serialized body, so the honest comparison is not four against one. The real figure
is plausibly twenty-odd against three, and **that is the ratio to defend** — that the difference
buys the ambients, one call path and the seed.

## Work gates

Each is a *does less work* contract, so a correctness test cannot guard it — the wrong
implementation still produces the right answer. Every one is verified by reverting the mechanism
and watching it fail, and the number it reports with the mechanism out is what the gate is worth.

| Asserts | Revert that must break it |
| --- | --- |
| 0 closures allocated per call over n rungs (16.15) | fold the chain per call → **measured: `Function:5 JSLexicalEnvironment:5` at n=5, from 0** |
| n rungs allocate ≤1 promise on an in-process call whose rungs are settled | drop the `isThenable` guard on `next()` → n promises, n microtask ticks |
| a page with three seeded reads runs each handler body once **across the page load and the hydration requests together** (41.14) | write the seed on a wire call only, per 16.14 as it stands → 2 per read, and the rungs twice |
| two concurrent requests reading one unkeyed memo load twice (11.34) | one process-wide entry map → 1 load, and request A's answer served to request B — see below, this revert is a disclosure and the gate for it is a correctness test, not this row |
| n requests over a `global` memo load once, n spanning two `createApp()` in one process (11.36) | file it under the scope → n |
| headers are out before the first chunk where a framing was fixed (D92) | derive the framing from the first chunk always → **0.8 ms → 61.4 ms TTFB**, the number already measured above; **batch the samples, a sub-ms op timed once returns the clock** |
| a room's last unsubscribe drops the entry (9.17), triggered by stream cancel | hold until retention drains → a permanent entry per key ever published to: **0 → 1 entry per key, unbounded over process lifetime** |
| a backpressured socket retains no more than the ring (D68) | buffer per connection → assert **bytes retained under a stalled reader**, since "allocates no queue" is not directly observable: **ring bytes → 5000 chunks buffered**, the direct-stream figure measured under "The flush" |
| `url()` allocates no `URL` per call | resolve the mount per call → 1 parse per row; **an invariant, not a cost — the cost is 0.44% of a frame at n=500** |
| scope teardown runs each disposer exactly once (12.6), fired by `request.signal` | tear down per read rather than per scope → n |
| an unwatched `abide:request` allocates no record (28.6) | build the record then check `log.enabled` → 1 record per request |

**One row moved out of this table, because it was never a work gate.** The timeout floor never
falling (16.24) is observable — a request 504s where it should not — so it is an ordinary
correctness test.

**The memo row did NOT move, and an earlier draft of this paragraph said it had.** "The first
request's answer served to the second caller" is **cross-request data disclosure** — the most severe
correctness bug in this document — and writing it in the *revert* column of a performance gate is
what left the correctness test it needs owed nowhere. Only the sentence describing the problem
moved; the row stayed. So it is owed twice over: the row above now names the disclosure explicitly,
AND a correctness test lands with stage 2 — two concurrent requests, distinct principals, one
unkeyed memo, asserting each sees its own answer. That test is not a revert gate and does not
belong in this table; it belongs in the stage that lands the scope.

So it is ten of eleven that leave the output identical — and that arithmetic was checkable from the
table itself, twice, and was got wrong both times. Getting it wrong teaches that the revert discipline is ceremony you
perform on things a normal test already covers, which is how it stops being run on the ten where it
is the only thing standing between the design and a silent regression.

## Budget

| | Target |
| --- | --- |
| allocations, request with no body | **~24 measured on a simpler path** — enumerated above; the target is a reduction against that, named line by line |
| allocations, in-process rpc read hitting a warm entry | 1 `Call` + n promises for n rungs, or 1 `Call` with the `isThenable` guard |
| microtask ticks, in-process read of a landed value | 0 — 2.1 has a read not await, and `isThenable` guards the path. Measured probe: 1 tick for a settled read, 2 for `await Promise.resolve(1)`, 1 again with the guard |
| `getStore()` calls, request reading three ambients | **3. Do not cache** — 2.9 ns each, 0.026% of a 33.2 µs request. The caching alternative is out of the budget |
| bytes, seed id carried per document | to be measured against the answer it replaces |
| LOC over the vanilla arm | **stage 0**, stated out loud |

## What must be measured before it lands

1. **Build `harness/server` first.** Every gate and every measurement here names it, and
   `packages/harness/src/server/index.ts` is `export {}` today — as are the other two lanes.
   `lanes.test.ts` asserts only that the three entries resolve. So stage 0 is not gated on writing a
   number down, it is gated on **building the lane that produces it**, which no stage previously
   scheduled. The good news is that it is small: `bun:jsc` exposes `heapStats`, `fullGC`, `heapSize`
   and `estimateShallowMemoryUsageOf`, `objectTypeCounts` after a `fullGC` gives per-type counts,
   `Function` + `JSLexicalEnvironment` is the closure count, and microtask ticks are countable with
   a re-queueing probe. Everything quoted in this document is ~40 lines of it, which is most of a
   first version. 2. **Name the share — against the right denominator.** The runtime's own layers as
   a fraction of **navigation → paint**, not of a page request. A page request is itself some
   fraction of the wait, so a layer measured at 4% of the request with the request at 30% of the
   wait has a ceiling of 1.2% — and the first draft would have written down 4%. That is the "0.055
   of a 1.45 ms op" arithmetic, one level up. Write the fraction down before optimising anything,
   and state the threshold that would make it worth acting on: a frame (~16 ms) or an interaction
   budget (~100 ms). "The expectation is that this layer is a few percent" is a prediction, not a
   threshold, and it gives nobody a reason to stop. 3. **The vanilla `Bun.serve` arm**, on the same
   route with the same answer, as a ratio and as LOC. The claim to defend is not throughput; it is
   that ~24 allocations against ~3 buy the ambients, and the ratio is what says how much they cost.
   4. **The seed's saving.** D39 says the round trip is still made and only the handler's work is
   saved, so the number is handler time per page load with the buffer against without it. 5. **Every
   gate gets the revert.** Ten of the eleven leave the output identical, so a green first run
   proves nothing.

Two things this list no longer needs. `AsyncLocalStorage` per ambient read is **measured**, above,
and the answer is not to cache — that item is closed. And `url()`'s per-row parse is measured and
falls below the perception floor, so it is an invariant gate rather than a measurement owed.

## What the docs owe

Each amendment names **the sections of this file it falsifies**, per the preamble — nothing else
will grep them.

RULEBOOK, amended:

* **16.14 loses "the seed buffer write", and says what "the framing" means.** The seed write is the
  one member that is a condition on the scope rather than on the call, and the one that must fire on
  the call the other six exclude; "the framing" must be read as the `Accept` negotiation alone or
  the seed cannot encode a stream. *Falsifies:* "The decision everything else falls out of" (the
  inert-variant sentence, which becomes true of six members and false of one) and the encode table's
  `maxBodySize` rows. Lands **first**, before the seed stage.
* **16.18 — `ctx.args()` caches per call, not per request.** Currently a correctness bug for two
  in-process calls to one handler in one scope. *Falsifies:* nothing here; "The onion" is written
  against the amended rule and must be re-read if it is refused.
* **16.38 — `Bun.file` and a plain `Blob` are not the same rule.** *Falsifies:* the encode table's
  two `Blob` rows, which are written against the amendment.
* **21.5 widened to three addresses**, adding `/__abide/config`; and REGISTRY's generated-headers
  row mirrors the same enumeration. *Falsifies:* "`config` on both sides".
* **22.1 — what `server` does inside a request with no socket.** Currently silent; this plan does
  not decide it, so it is an OWED DECISION filed here for adjacency rather than an amendment this
  plan schedules — the distinction matters because the amendments above land with their stages and
  this one blocks on a decision nobody has made. *Falsifies:* "`server()` where there is no socket",
  either way. Also cited at `docs/BRAND.md:94`, where 22.1 is one of four clauses behind the "Same
  name, both sides" claim — a BRAND commitment, so whichever way it goes, that line is re-read.
* **16.23 — the floor produces a 504**, per chunk on a yielding handler; and `server.timeout` is an
  idle timeout that does not bound a busy handler, so the refusal is abide's. *Falsifies:* nothing;
  "Cancellation and teardown" is written against it.
* **38.15 withdrawn, 38.16 rewritten, 38.18 corrected — the dev worker goes.** 38.15 ("MUST hold
  the app in a worker and keep the listener on the main thread") has no subject once the worker is
  refused. 38.16 becomes *`abide dev` MUST restart the app to reload*, and its force-close half
  stops being a step the runtime performs — every socket drops because the process did, which is
  the same outcome reached by the mechanism rather than by a clause. 38.18 says the reload client
  "MUST be served by the dev **worker**" and becomes "by the dev server". *Falsifies:* "The dev
  split, and why there is not one" is written against the amendment rather than against the clauses
  as they stand, and says so; and stage 11.

  **`docs/REGISTRY.md:696`** — the `abide dev [--port <n>]` row cites `38.4, 38.15, 38.16, 38.17,
  38.18, 38.20` and loses 38.15. The gate builds its id set from live clauses, so this row is forced
  by the withdrawal, not optional.

  **`docs/DECISIONS.md:1697` — D100, and this is the one that matters.** Its `Assumes:` line reads
  `38.15, 38.16, 42.5`, and its **Because** opens *"`abide dev` keeps the listener on the main
  thread and replaces the worker under it, so a hook tied to the bind would run on a schedule
  belonging to the reload rather than to the app, and would report a port the host owns and the app
  never chose."* Withdraw the worker and that entire first leg is gone — while D100 goes on reading
  as valid, nothing contradicting it, only its reason having stopped being true. **That is D3's
  shape, produced by this plan, on a decision that landed two commits ago.** The conclusion is
  probably safe: `createApp` is still where the tables, the onions and `config` land, and 42.5 still
  has `App.fetch` answer where no socket is bound, so 37.4 and 42.4 survive on the second leg. But
  "probably safe" is what D3 was for fifty-two entries. D100's `Because` is rewritten to rest on the
  leg that survives, and its `Assumes:` drops 38.15 and 38.16, in the same change as the withdrawal.

* **27.6 widened** — what `config.invalidate` means where there is no environment to re-read.
  *Falsifies:* "`config` on both sides", where the browser arm's invalidate is described against the
  unwidened clause. This was the one amendment bullet with no `Falsifies:` line, in the section whose
  whole premise is that every bullet has one.
* **36.2 widened** — `APP_URL` currently exists for the origin gates alone, and four content pages
  have it deciding the mount every address resolves against. **Must not move 18.5's `Host` fallback
  while widening.** *Falsifies:* "Addresses and the mount" if the widening lands differently.
* ~~**37.4 — `onStart` wraps `createApp`, not `listen`**, so a hook cannot observe the port.~~
  *Landed:* 37.4 amended, 42.4, D100.

RULEBOOK, new clauses:

* **`/__abide/**` is reserved from app routes.** 20.8 does not say this and the three-arm dispatch
  needs it; without it, arm 2 silently shadows an app mount.
* **The seed buffer is written only where the scope is a render.** Striking 16.14's member removes a
  condition and adds none; this is the replacement.
* **The seed id is cryptographically random and bound to the `principal.caller` that created it.**
* **`response` throws once the first chunk is out**, naming the cutoff — Bun drops a late
  `headers.set()` silently, and 22.11 currently promises a writable response for the whole handler.
* **the layout chain's nesting ORDER.** 35.1 and 35.2 give a layout a slot and nearest-ancestor
  resolution; outermost-first is stated only in `give-pages-the-same-chrome.md`.
* what `url` and `rpc.url` resolve against on each side, and that the prefix is a path;
* that the document carries exactly two config values, and which;
* that `/__abide/config` serves only the keys `public` declares;
* the three scope shapes — *partly landed:* 42.8 gives the requestless shape and 42.5 the wire one,
  and the shape between them is open exactly where `server()` is. Note the draft the first version
  of this plan carried ("a wire scope is the only one carrying `request`, `response`, `server` and
  `cookies`") is **wrong**, because it makes `server` a property of the wire and licenses it in the
  `fetch`-without-`listen` scope;
* the three dev-only asymmetries, each of which is a divergence from the consistent-runtime goal;
* `access-control-max-age`'s number, which appears nowhere in the four documents.
  `ABIDE_MAX_STREAM_BUFFER_SIZE` was listed here too and should not have been: it has a REGISTRY row
  at `docs/REGISTRY.md:634` citing 16.41, and is named at `docs/RULEBOOK.md:789`. What it lacks is a
  DEFAULT, which is a different gap and is filed under "Still undecided" with the seed store's
  bound.

REGISTRY, new rows: `<meta name="abide-mount">`; the seed id, in whichever spelling wins;
`ConfigOptions.public`; `/__abide/config`. And `url`'s and `rpc.url`'s rows citing the mount clause,
and `server`'s row citing whatever 22.1 becomes. ~~`createApp`, `App.fetch`, `App.run`,
`App.listen`, `App.stop`~~ *landed* under "The app object", governed by RULEBOOK 42 — and
`createApp` is rowed with no options, this plan's `createApp(options?)` never having enumerated
one.

CONTENT, corrected: **`server/let-another-origin-call-you.md:44`** justifies answering the preflight
outside middleware "for the same reason `/__abide/health` is" — a reason 25.2's withdrawal and D62
killed. It is live today and it is the resolves-but-drifted case.

RENDERER.md owes: **a scope parameter on the compiled render program**, beside `context` and not
merged into it. The bound that keeps `AsyncLocalStorage` out of the per-node path depends on it and
`stream(context)` does not currently carry it.

COMPILER.md owes: **16.27** among its static refusals, or this plan stops citing it as a build
error; and the **build-time script hash** 29.9 needs in `script-src`, which must reach the csp rung
from the compiler and is named by neither plan.

DECISIONS, one entry per refusal, each naming what it assumes and what it decides:

* **the wire path as a second lane**, refused for the two implementations of authorisation;
* **`new URL` per call**, refused **for the silent sub-path drop** — and the entry does *not* cite
  the per-row parse, which measures at 0.44% of a frame at n=500 and crosses a frame at 113k rows;
* **an absolute prefix on the server**, refused on 41.7 — every server-rendered address would
  differ from what the client re-executes;
* **Bun's own router for the page trie**, refused for `[[name]]`/`[...name]` and for `app.fetch`
  dispatching with no `Bun.serve` in the picture;
* **a `public` denylist or prefix convention**, refused because `Config` merges the whole
  environment;
* **an app-written public-config handler**, refused on the isomorphism goal rather than on
  capability — and the entry says so, the arm being three lines;
* **a per-connection socket send queue**, refused as D68 refused a buffer beside the ring;
* **a `type: 'direct'` stream in `flush`**, refused for having no backpressure — measured, 312 MiB
  buffered against a client that read 800 KiB;
* **the dev worker and its host relay** (38.15), refused for four divergences from the
  consistent-runtime goal against two things it buys, one of which 38.16 already gives up. The entry
  names `ws+unix://` too: it works in Bun 1.4.0, so the relay's upgrade-termination never followed
  from capability, and with the worker gone neither the relay nor the refusal has a subject;
* **in-process `server.reload()`**, refused for a module-registry leak that is linear in saves and
  unreclaimed — measured, 20 → 179 MiB over 40 graphs — and for a dirty slate across reloads. The
  entry carries the boot-to-bound number that makes restart the cheaper failure;
* ~~**`app.fetch` reachable only through a listener**, refused for the test that then needs a
  port.~~ *Landed:* D98, on the no-port argument alone. D99 landed beside it, refusing a generated
  test client — the surface a reader reaches for before they reach for `App.fetch`.

## Stages

Each is gated by the one before it.

0. **`harness/server` and the vanilla arm.** The lane does not exist; nothing else starts until it
   does. LOC over vanilla is stated here, not at stage 3. What lands is what `harness/server`
   actually measures — bytes, microtask turns, allocations on bun — against the 11-line `Bun.serve`
   arm.

   **Measurement 2 does NOT land here, and an earlier draft gated everything on it.** The share
   against navigation → paint is an `harness/engine` number: Blink over CDP, chromium only, driven
   from the playwright side. Getting it needs a served page, which is stage 6, which needs
   `RENDERER.md`'s `stream` and `COMPILER.md`'s server backend. A stage 0 that demands it is a stage
   0 that depends on stage 6, and the eleven stages under it never start. So measurement 2 is taken
   **after stage 6**, and what stage 0 owes instead is the share the SERVER layer holds of one op
   `harness/server` can see end to end: request → last byte, no browser in it.
1. `Scope`, the store, `app.run`, and the ambients that throw. No wire, no tables, no dispatch.
   Gate: the disposer-exactly-once revert.
2. `createApp`, `App.fetch`, the three dispatch arms, `notFound`, and the generated headers of
   21.1–21.3 **and 21.6 and 21.7**. One handler, no onion. This stage needs a minimal `encode` — a
   dispatch miss is a refusal and a refusal is `encode`'s — so "encode in full" at stage 4 is a
   widening of what lands here, not a first landing. `trace` (24.1) lands here too, because 21.2
   needs it. Gate: the header assertions, a dispatch miss, and **the sub-path e2e spec**, which the
   empty `packages/dogfood/e2e/` owes.
3. The onion, `ctx.args`, coercion, timeouts and the 504, and the wire-only steps of 16.14 — on
   `call.wire`, not `scope.wire`. **The SIX members that survive stage 7's amendment, not all
   seven.** Landing the seventh here and striking it at stage 7 is a mechanism landed and then
   replaced four stages later, and the replaced path would be read and trusted by everything between
   — so the seed-buffer member is never written, and its absence is a comment naming stage 7 rather
   than a gap. Gate: the rung count on an in-process call, which is D15 and which a correctness test
   cannot see; and the promise-per-rung gate. Also: the cross-request memo disclosure test owed by
   "Work gates" lands at stage 2 with the scope, not here.
4. `encode` widened — the framing table, streams, blobs, ranges, refusals, 16.42's html navigation —
   and `flush`, on a pull-based stream. Gate: D92's TTFB revert.
5. **Errors and cancellation.** `onError`, the render boundary's escape, the mid-stream throw,
   `request.signal`, teardown. Gate: the disposer revert *fired by an abort*, which is what makes
   stage 1's gate reachable.
6. **The page path.** The layout chain, the `Shell`, head merging, `route` and `online`. Gate: a
   page served under both e2e projects.
7. The seed buffer. **16.14's amendment, the render-scope clause, D99's re-reading, and the seed-id
   capability clause all land first** — the last of which is not drafted yet, per "The seed id is a
   bearer capability". Stage 3 already left the struck member out, so nothing here replaces a path
   that shipped.
8. Rooms, the mux, the socket lane, and `log.ts`'s producers.
9. The internal surfaces: health, principal, config, openapi, mcp, logs — each an ordinary entry,
   which is what makes 20.8 fall out rather than be enforced. **`config` does not start until
   `config()`'s browser type is chosen**, and all three are gated on `ABIDE_OPENAPI` / `ABIDE_MCP` /
   `ABIDE_LOGS` (20.7, 36.7) making a closed surface answer 404 — which is a condition on an
   entry's *presence*, and the exact-map dispatch has no room for it as written.
10. `principal`'s seal: the HMAC, the rotation list, the cookie attributes, refresh-at-half-spent.
11. `abide dev`: the watcher, the in-memory client build (38.17, 38.18), and restart-on-change.
    **No host, no worker, no relay** — the stage is a file watcher and a process, and the runtime it
    boots is the one stage 2 already built. Gate: boot-to-bound for the dogfood app, against the
    ~100 ms interaction budget; and an e2e spec that saves a file and asserts the reload client
    reconnects rather than surfacing the refused window.

## Reproducing the reload numbers

Bun 1.4.2, macOS arm64, 2026-09-10. Three probes, and the dev-split argument above rests on all
three. They are here because nothing runs them yet; `harness/server` is the lane when it exists.

**The handler swaps in place.** Serve `port: 0` with a handler from one module, `await import` a
second, `server.reload({ fetch })`, and read the answer before and after. Assert the port is
unchanged and the body moved. Reported: port stable, `v1` → `v2`.

**A re-import is cached and a query bust is not.** `import('./mod.ts')` twice, then
`import('./mod.ts?v=1')`, comparing a module-scope `Math.random()`. Reported: the first two agree,
the third differs.

**A busted graph is never released.** Export a 4 MiB `Uint8Array` from the module, read
`process.memoryUsage.rss()`, import `?v=2` through `?v=40`, then `Bun.gc(true)` twice with a
`setTimeout` between so a deferred sweep has a turn. Reported: 20 MiB → 179 MiB, ~159 MiB retained
against 160 MiB imported. Run it at two graph counts rather than one — a ratio between two sizes of
the same structure is the timing-free claim, and it is what says "pinned" rather than "large".

**Boot to bound.** `Date.now()` in one process against `Date.now()` after `Bun.serve` returns in
another, five runs: 11, 8, 8, 8, 9 ms. This is a trivial script and the real number is a real app
graph — **the measurement to take before this lands** is boot-to-bound for the dogfood app, since
that is the refused-connection window an author actually sees. If it crosses ~100 ms the interaction
budget is in play and `server.reload()` comes back on the table with its leak priced against it.

## Still undecided

* **The seed id's spelling.** An attribute the document carries and the client echoes in a header,
  against a cookie. The cookie is fewer moving parts and is per-visitor rather than per-render,
  which two tabs make wrong; the attribute needs a REGISTRY row and a header name. Note the cookie
  arm is also in tension with the D26 this section cites below — a per-visitor server-side buffer
  keyed by a cookie is close to the session store D26 refuses.
* **The seed store's bound.** 16.41 bounds a stream tee with `ABIDE_MAX_STREAM_BUFFER_SIZE`;
  nothing bounds the count or the TTL of seed entries, and a TTL shorter than a slow client's
  hydration turns into spurious 41.11 mismatches. It is the one piece of server-side per-visitor
  state in a design that is otherwise stateless by D26, so it is owed a number and an env name.
* **`config()`'s type in a browser.** The three repairs above, and the sixth type-directed site is
  the one that needs `COMPILER.md`'s agreement. Gates stage 9.
* **What `server()` is under `app.run` with a request but no socket.** This plan does **not** decide
  it: 22.1 is silent, 23.7 and 23.8 are precedent for the inert stub rather than against it, and
  CLAUDE.md's uniformity bias points at the stub. Whichever wins is a clause, a REGISTRY note and a
  DECISIONS entry.
* **What a throw after the first flush emits, per framing.** sse has `event: reset`, jsonl has an
  envelope, `bytes` has neither and the status is already spent.
* **Whether `log.records` survives its last reader.** 9.17 drops a room on last unsubscribe;
  `record-what-happened.md:113` promises a ring "gone when the process is" and `abide logs` reads it
  after the fact. Either a room with a `tail` is exempt from 9.17 or `log.records` is not an
  ordinary room.
* **Where 10.5's owner lives.** `REACTIVE.md`'s "where a scope lives" asks for one mechanism serving
  10.5, 11.34 and 13.8. This plan answers 11.34. The component-instance stack 10.5 needs is
  `RENDERER.md`'s and is unwritten.

## What this revision changed

Kept for one review cycle, then deleted with the file. The first draft was written from the rpc call
path outward and was strongest there — the one-call-path decision, the 16.14 finding, the `new URL`
finding and the D92 reading all survive. What it was missing was everything the **page** path and
the **failure** path need, plus everything that happens when a request or a process **ends**; and
its cost model was an estimate presented as a budget. Four things moved: the wire condition is on
the `Call`; four sections exist that did not (the page path, errors, cancellation, logs); the
allocation count went from an asserted four to a measured ~24; and `getStore()` was measured at
0.026% of a request, which closes an open question rather than leaving it to a stage.
