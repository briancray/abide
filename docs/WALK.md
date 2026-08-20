# the render walk, justified

Every step a root-to-leaf render takes, what it is there for, and what it costs a render whose wall
time should be **max(walk)** rather than **sum(walk)**. `docs/ASYNC.md` is why a pending read signals;
this is what the walk does about it, and where it still pays the sum.

## the property

A render does two kinds of work. It WRITES — bytes into a buffer, which is real work and scales with
the document — and it WAITS, which is not work at all. Waiting is where the wall clock goes: three
60ms loads are 180ms of nothing happening, against about 40µs of walking for the markup around them.

So the target is exact:

> **max(walk)**: a render's wall cost is its write work plus the LONGEST single wait in it, not the
> sum of its waits.

And it holds under exactly one condition:

> Every wait a leaf will make is IN FLIGHT before the walk blocks on the first one.

That makes every step of the walk one of three kinds, and gives each a justification to answer:

| kind | what it does | what it owes |
| --- | --- | --- |
| WRITE | bytes into `out.text` | not to cost a promise, a tick or an allocation when nothing is waiting |
| START | puts a load in flight | to start what the walk was going to demand anyway, and nothing else |
| BLOCK | stops the walk | that nothing downstream of it could have been started first |

A BLOCK with unstarted work under it is where sum(walk) comes from, and it is the only place it comes
from. Nothing else in the walk can produce it.

## what it costs today

Three independent 60ms loads in every row, so `max` is 60ms and `sum` is 180ms. The markup is
identical in every row — which is the whole reason the assertion in each demo is the PEAK IN FLIGHT
and not the output. Measured on bun/JSC, `/tmp/walkshape.ts`:

| shape | before | after | |
| --- | --- | --- | --- |
| three plain slots, nothing started | 185 | **62** | max |
| three loads, one per component, nested | 184 | **61** | max |
| three loads, three sibling components | 184 | **61** | max |
| three loads behind a conditional slot | 184 | **61** | max |
| three rows, one load per row | 183 | **62** | max |
| three deferring regions, `renderToString` | 183 | **61** | max |
| three attribute slots, each a load | 183 | **62** | max |
| two spreads, each a load | 123 | **62** | max |
| STREAM: three plain slots | 185 | **63** | max |
| STREAM: three loads in three components | 187 | **62** | max |
| STREAM: three rows, one load per row | 183 | **66** | max |
| STREAM past the cap: four gapped loads, slow consumer | 224 | **108** | max |
| three promises already in flight in three slots | 61 | 61 | max |
| `{#try}` body holding three `{await}` holes | 61 | 61 | max |
| three deferring regions, `renderDocument` | 62 | 62 | max |
| one thunk reading three loads | 188 | 184 | sum, justified below |
| deferring region nested inside a deferring region | 123 | 122 | sum, justified below |

`before` is the walk that blocked; `after` is the same walk taking a HOLE — see "the collapse, as
built". Six of the eight sums are gone. The two left are the two where the second load is not
DISCOVERABLE until the first settles, which is a dependency in the source rather than an ordering the
walk imposed.

The gates, each in `demos/server.ts` and each verified by reverting its own line: "a region that WAITS
does not hold the walk" (peak 3, back to 1), "a STREAMED render takes the same hole" (3 → 1), "an
ATTRIBUTE that waits holds only itself" (3 → 1), "past the hold cap the walk PATCHES rather than
blocks" (patches → none, and a stranded walk → a red line), "a deferred subtree may defer AGAIN" (two
patches → one), and `deferring.abide` for the probe's own kick. Every one has byte-identical markup on
both sides of its revert, which is why none of them is an output test.

The STREAMING lane takes the same hole. What a hole holds back is the markup AFTER it, which had not
been sent either — so the consumer is given everything up to the first open hole and the walk carries
on past it, in document order however the holes settle.

Two limits keep that honest, and both were found by breaking something. A SOURCE may not take a hole
at all, because a hole hands over a region when it is COMPLETE: `{#for await}`'s eight rows collapsed
from eight chunks into three, and a channel in a slot, which never completes, hung the render
outright. And bytes held behind an open hole are capped at eight chunks — past which the walk SPILLS,
which is the next section.

## the sync walk: what it must not pay

A tree with no promise in it is the common render, and every one of these exists so that it costs no
async machinery at all. `renderToString` of a promise-free tree runs to completion without a single
microtask; the caller's own `await` is the only tick.

| step | what it does | why |
| --- | --- | --- |
| `emit`'s `typeof` switch | string / number / bigint / boolean / undefined / function first | a thousand-row table's slot values are strings and numbers, and the brand checks below are seven prototype probes each would otherwise pay |
| `Rest = Promise<void> \| null` | `null` means the node finished | an async generator hands back a promise for a value it already has, and every `yield*` level pays it again — 2550ns/row against 115ns |
| `Out.flush = null` | no consumer, nothing to hand over | `paused` and `handOver` return `null` without allocating, so no slot can pause |
| `paused` reads `HIGH_WATER` directly | not a field on `Out` | a per-`Out` number is a knob with one live value, read per child slot and per array element |
| `handOver` is not `async` | guarded at every call site | an unconditional promise costs a wrap and a tick PER ROW of a streamed list to learn there is no consumer |
| resumption closures | built only on the branch that waited | the common slot allocates nothing it did not already |
| `resumeAttribute` / `resumeSpread` are free functions | not closures in the case body | an attribute whose value is in hand allocates nothing |
| `planOf` | slot kinds and pre-cut static text, cached per template | the `name=` cut happens once per call site rather than per slot per row, and `texts` is a packed copy of a frozen array |
| `Budget` arms on first wait | no timer until something suspends | a page with no promise in it cannot run out of wall clock, so it never even asks |
| `Out` field order fixed | `stream`'s and `renderToString`'s match | a document render has both alive at once and `emit` reads both per node — two orders are two hidden classes |

None of these is about max(walk). They are why the sync case does not pay for the async one, and the
justification each owes is only that it stays that way.

## the async walk, root to leaf

The spine, in order, with what each step does to the property.

### 1 · entry — `renderDocument` / `renderFragment` / `renderToString` / `renderDocumentToString`

Reads the budget, builds the deferral list, and decides ONE thing that everything below turns on:
`context.document`. Non-null means there is somewhere to patch, so a region with something to show may
be sent as a placeholder; null means the markup must be complete when the string is.

That single field is what split the same three deferring regions into 62ms with a document and 183ms
without, before holes existed. **Justified**: a reader running no scripts keeps whatever the
markup holds, and a placeholder forever is half an answer. **Not justified as a SUM**: completeness
requires the walk to have the settled value, it does not require the three loads to start one after
another. This is the largest single gap in the table.

### 2 · shell — head, styles, open

One write. `isServing() ? nonce() : null` is read ONCE for the document rather than per patch, and the
whole stylesheet goes out in the shell because every scoped `<style>` registered at module scope
before the render began. **Justified**: no wait, and the read that could have been per-patch is not.

### 3 · `openSeeding()` before the first byte

The first rpc read happens inside the walk below and needs somewhere to land. **Justified**: a write.

### 4 · `body()` — the root thunk

Called inside the request scope, which is why `renderDocument` takes a thunk and
`renderDocumentToString` takes the node: a generator's body does not run until the first `next()`,
which the runtime pulls from its own context. **Justified**, and it is also the earliest moment
anything in the tree can be started.

### 5 · `emit` — the dispatch

Thirteen arms. Nine are writes or descents and cannot wait: string, number/bigint, boolean/undefined,
`null`, `Raw`, `Keyed` (carried and dropped — a key says which row this is, and nothing here moves
rows), array, template, and the `String(node)` fallback. Four can:

| arm | what it does | verdict |
| --- | --- | --- |
| `function` | `emitProduced(thunk)` — see 7 | may block |
| `Component` | `emitProduced(() => view(stateProps(props)))` | may block, and starts nothing until called |
| `Boundary` | `emitProduced(() => settledBoundary(node))` | body runs synchronously; its holes are already in flight |
| `Awaited` | pending arm + document → defer; else block | the decision in 1 |
| `Streamed` / promise / async iterable | 8, 9, 10 | may block |

The `Boundary` arm is the one place the walk already gets max for free, and reading WHY is the whole
design in miniature: the body runs synchronously even when it awaits, so every `{await}` hole in it
is a promise that exists before any of them is awaited, and `settledBoundary` folds them into one
`Promise.all`. Nothing had to be analysed. The holes were started by the body running.

### 6 · `emitTemplate` — the slots

Per slot: write the pre-cut static text, then one of six kinds.

| kind | what it does | why |
| --- | --- | --- |
| `child` | `OPEN_MARKER`, `emit(value)`, `closeMarker(i)` | the markers bracket the VALUE, the one part the client's own template does not describe |
| `attr` | `retryableCall(unwrap, value)` — a catcher | the client BINDS `class=${() => tone()}` once the load lands, so a server serving `undefined` drops an attribute the client then has, and nothing compares the two lanes |
| `spread` | the same, then `Object.keys` | `{...await props}` compiles to an async thunk, so what arrives IS a promise — read as an object it spread nothing at all, silently |
| `event` | nothing | no listeners in a string |
| `property` | nothing | a DOM property has no serialisation |
| `ref` | nothing | no nodes here |

An attribute or spread that waits resumes at the NEXT slot, never its own: the static text in front of
it is already in the buffer. **Justified as a BLOCK**: the attribute belongs to an element the walk is
in the middle of writing, so there is no ordering to recover — but the loads in the slots AFTER it are
still unstarted while it waits.

### 7 · `emitProduced` — the six producers

The slot thunk, the component call, the `{#try}` body, the `{#for await}` row, and both settled-arm
bodies. `forgetProbedLoad()`, then `retryable(produce)`, then three answers:

| answer | path | what it does |
| --- | --- | --- |
| produced a value | `emit(produced)` | write |
| threw a `Pending` | `awaitPending` → `awaitedProduce` | BLOCK: wait that load out, call the producer again |
| probed an unlanded load | document ? `emitProbed` : `awaitProbed` | defer, or BLOCK |

`awaitedProduce` is the only wait-and-retry loop in the walk, and it is a LOOP because a body reading
three loads signals once per load. **Justified as a mechanism** — one recovery, three callers that
differ only in what they do with the value. **Not justified as a sum**: 188ms for one thunk reading
three loads is three passes, each starting the next load only after the previous settled. The retry
learns the reads one at a time because a throw carries one state; nothing about the body says it could
not have been told about all three.

`emitProbed` is where the property is actually won: the region's placeholder goes out, the walk
continues, and the re-run lands in `document.deferred`. Row 4 of the table.

### 8 · `emitAwaited` / `emitPromise` — a value in document order

`handOver` first — everything written so far goes out BEFORE the walk waits, which is what "streams in
document order" means — then `await`, then the arms through `emitProduced`. **Justified**: a promise
in a slot is already in flight by definition, so N of them in N sibling slots cost their max (row 1 of
the table, 61ms). This arm cannot produce a sum on its own. It produces one only when the promise did
not exist until the walk built it, which is a load behind a state rather than a promise in a slot.

### 9 · `emitStreamed` — `{#for await}`

Forks on `isAsyncIterable`: `for await` over a sync source wraps every item in a promise and pays a
tick per ROW. The async arm calls `handOver` per row (a chunk boundary is a suspension); the sync arm
calls `paused`, because `handOver` would cost a full consumer round trip per row.

**Justified as a sum**: rows arrive in the order the source produces them, and that IS the source's
semantics. The one thing to note is that a row BODY is a producer, so a row reading its own load makes
row 6 of the table — 183ms for three rows — and that sum is not the source's, it is the walk's.

### 10 · `emitAsyncIterable`

`handOver`, then `for await`, then `emit` per child. Same justification as 9.

### 11 · the leaf

`escape(node)` for a string, `String(node)` for a number, `node.html` for a `Raw`. Nullish and BOTH
booleans are nothing, which is the child-position half of the rule `$ui`'s `textOf` states — the two
lanes have to agree or a hydration mismatch follows. **Justified**: a write, and the only step in the
walk that cannot wait.

### 12 · back-pressure — `paused` and `flush`

The buffer goes out at `HIGH_WATER` and the walk parks only when the queue is more than one chunk
deep: one unread chunk is slack, two is a consumer falling behind. Handing over after every RESOLVED
slot as well cost about eleven microtask turns per row against none for the same render into a string.
**Justified**: it is a wait on the CONSUMER, not on the tree, and it cannot be collapsed by starting
anything earlier.

### 13 · after the walk — `close`, `drain`, `seeds`, `tail`

The hydration root closes BEFORE the drain writes anything: a patch is a `<template>` and a `<script>`
the client's own render never produces, so written inside the root they are two extra children and the
top-level part rebuilds the page it was handed correct markup for.

`drain` is the max(walk) collapse, and the only complete instance of it in the codebase. Each subtree
subscribes ONCE when taken and pushes into `landed`; `Promise.race` over the pending set instead
attached a fresh reaction to every subtree still in flight on every patch, and nothing detaches those
— N deferrals cost N²/2 retained reaction records. **Justified, and it is the shape the rest of the
walk wants**: the subtrees are all in flight together, and the loop's cost is their max.

### 14 · the budget

ONE clock per render, spanning the walk AND the drain, armed on the first phase that actually waits.
A per-phase clock would be a per-phase budget wearing a wall budget's name, and a page that suspends
is exactly the page the budget is for. **Justified**: a sum of waits is also a budget spent N times
faster, so this is the one place where sum(walk) is not merely slow — it is what turns a page that
would have rendered into a truncated one.

## the collapse, as built

`Out` gained two fields and the walk gained one fork.

```ts
function waits(out: Out, run: (into: Out) => Promise<void>): Rest {
    return out.flush === null ? hole(out, run) : run(out)
}
```

`hole` pushes what is written so far into `segments`, reserves the next slot, hands `run` a buffer of
its own, and returns `null` — so the walk goes on to the next sibling and starts what IT reads.
`assembled` joins the segments once every fill has settled, and `Promise.all` over the fills is where
the sum becomes a max. The six waiting branches — `awaitPending`, `awaitProbed`, `emitAwaited`,
`emitPromise`, `emitStreamed`, `emitAsyncIterable` — are unchanged; each is now called through
`waits`, and each already had exactly the shape a hole needs, an async function writing into an `Out`.

What it cost, honestly:

- **The sync walk: level on a page, +8% on a tiny one.** A 1000-row table renders in 239–263 ns/row
  against 257–260 before. A `<p>` with two slots went from ~150 ns to ~162 ns, which is the four new
  fields being initialised — measure on a QUIET machine or this reads 5x, as it did once here.
- **One trap paid for itself immediately.** `renderToString` returning `assembled(out)` cost a small
  render 153 → 206 ns, 35% — an async function that never awaits is still a promise and a tick. The
  null check is now in `renderToString` and the small render is back to 296–333 ns per 2000.
- **Machinery**: +4 fields on `Out`, +6 functions (`holds`, `waits`, `streams`, `hole`, `assembled`,
  `sendable`, plus `intoString` / `deferredContext` for the nested case), 0 exported names, 1 branch on
  a path that was already about to wait. No public API moved.
- **The gates**, each verified by reverting its own line: "a region that WAITS does not hold the walk"
  (peak 3 → 1), "a STREAMED render takes the same hole" (3 → 1), "an ATTRIBUTE that waits holds only
  itself" (3 → 1), "a deferred subtree may defer AGAIN" (two patches → one). Every one of them has
  byte-identical markup on both sides of the revert, which is why none is an output test.

## where it sums

Five mechanisms. Three are gone; two are justified, and both for the same reason.

**A · a body reading N loads** — 188ms, still 184ms. GONE for the rest of the page, not for the body:
`awaitedProduce` learns one state per signal and waits it out before calling the producer again, and a
hole cannot split a region that is a single producer. **Justified**: the body reaches its second read
only by running past the first, so the second load is not discoverable until the first has landed. A
region that wants its loads in flight together has to SAY so — split the region, or ask about each
load with a probe, which starts what it asks about — and the walk cannot invent that.

**B · component subtrees** — 184ms → 61ms. A component's setup runs when the walk calls its view, so a
child's loads cannot start before the parent's slot is reached. No compile-time pass could cross that
boundary; the hole does not have to, because it continues the walk INTO the next component rather than
predicting what is in it.

**C · guarded slots and rows** — 183–184ms → 61–62ms. The compiler's descent stopped at every block, so
a load under `{#if}` or inside a `{#for}` row started when the walk arrived. Coverage there was
anti-correlated with the goal — a load worth starting early is exactly the one an author guards — and
this is the half of the table that fixed it. On the record in `f9f2eb2` and now answered in the walk,
as that commit said it should be.

**D · probing regions with nowhere to patch** — 183ms → 61ms. `awaitProbed` waited inline, one region
at a time, for a completeness requirement that is on the OUTPUT and not on the timing: the loads can be
in flight together and the string is still complete when it is returned. `renderDocumentToString` — the
mail, the fixture, the crawler — is the caller that gets this.

**E · nested deferral** — the TOTAL is still 125ms and always will be: the inner region does not EXIST
until the outer producer has been re-run with its load settled, which is A's reason one level up. What
moved is when the outer region reaches the reader. A deferred subtree now renders with the document
carried through, so the inner block registers a patch of its own: the outer patch goes out at 64ms
carrying the inner PLACEHOLDER, and the inner follows at 125ms, where before they arrived together as
one patch at 123ms. `drain` reads a list that GROWS under it — a cursor, plus a `take()` after each
patch — and the ORDER needs no arranging, because a nested load cannot start until its parent's has
settled and so cannot land before the patch that puts its placeholder in the document.

## the two collapses, and which lane each is available in

Everything above resolves into two independent mechanisms, and keeping them apart is the point.

**Starting is not ordering.** Putting a load in flight earlier changes no byte of the output and is
available in every lane, streaming included. A probe kicking the load it reports is what is left of it
— `started()`, which reached a lazy state's `then` as the walk passed, and `start([…])`, which the
compiler emitted above a template, were the other two and are both gone. Its ceiling is knowing WHICH loads to start, which is why the compiler-side
form cannot reach B, C or D: a syntactic predicate over one component's unconditional slots is the
most that can be known without running anything.

**Ordering is what the walk can do that the compiler cannot.** A blocking region does not stop the walk
— it takes a HOLE, and is filled when it settles. Continuing IS the start: every producer downstream
runs, every load it reads goes in flight, and one fork covers B, C, D and the row case together, with
no analysis, no new public name, and nothing that can start a memo with no load in it.

**The cap SPILLS rather than blocks, and that is what finally replaced `start([…])`.**

Blocking at the cap bounded the buffer by refusing to write more, at the price of the loads after it
starting one at a time again — measured at 224ms against 161ms with `start`, on four 60ms loads
separated by 60kB each and a consumer paying for bytes. So for one round `start` was load-bearing
after all, and the honest reading was that the two answered two regimes.

Spilling removes the regime. At the cap every open hole becomes an empty PLACEHOLDER now and a
`<template>` plus a `$p` call when it lands — the machinery a `{#if x.pending()}` region already uses.
The held bytes become sendable, the buffer is bounded, the loads stay in flight, and the same page
measures **108ms without `start` against 106ms with it**. Both arms also beat the old blocking best,
because the bytes leave instead of being held.

So `start([…])` is gone, with `eagerCells` / `memosReferenced` / `rootsOf`, the `'start'` need-kind,
the export on `abide/runtime`, its own demo in `memo.ts`, and the two fixtures — `concurrent.abide`
and `derived.abide` — whose cases the walk had already made vacuous.

**What it costs the reader, which is the whole trade.** A patched region needs JAVASCRIPT to appear,
so a crawler on a page that crossed the cap sees the placeholder. That is why the spill is announced
on abide's own `render` channel rather than being silent: the size at which a page's fidelity changes
is not something an author can see in their own source. A STRING render cannot reach it — its buffer
IS its output, so `renderToString` and `renderDocumentToString` hold everything and always produce
complete markup.

What is still open:

- **Read order.** Producers downstream of a hole run BEFORE the region above them settles. Nothing in
  a snapshot render observes that order and the whole suite is green either way, but "nothing" is a
  claim about every app rather than about the walk, and setup running once is what it rests on.
- **The held-bytes cap is a constant**, not a knob, and eight chunks is a choice rather than a
  measurement. The number that would settle it is peak held bytes on a real page under a slow load.
- **The two remaining sums**, below, which are the source's own dependencies rather than the walk's.

## the client lane

For completeness, since the same walk exists there and the property is already true. A promise in a
slot does not block its siblings: `ChildPart` keeps showing what it has and paints on settle, the
enclosing effect never awaits, and a signal is caught in `pull`/`rerun` so the part simply keeps what
it had. So a browser render is max(walk) by construction — there is no document order to preserve
because nothing is being serialised, which is precisely the constraint the server walk is paying for.
Structural rather than measured here; the server is where the sum lives.
