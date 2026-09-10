# Reactive core — implementation plan

*Status: not landed. Nothing in this file is decided.* A plan is not a fifth governed document —
where it disagrees with RULEBOOK, REGISTRY or DECISIONS, those win and this is stale. Its job is to
carry the part sixteen clauses cannot: what the code looks like, in what order it lands, and what
number would falsify it.

## What this is

An implementation of REGISTRY's "Reactive primitives" — `state`, `memo`, `channel`, `watch`,
selections, tracking — against RULEBOOK 1–15. The framework has no reactive code today
(`src/shared/index.ts` is `export {}`), so this is the first landing rather than a refactor.

## The shape

**One node type, three faces.** 1.1 has every producer hand back a `Reactive`, so `state`, `memo`
and `channel` are three constructors over one `ReactiveNode`, differing in which fields are filled.
A room is a node whose `identity` defaults to the reference (5.5) and whose triggers are inert
(7.13); a memo is a node that additionally owns a `Reader`. This is CLAUDE.md's uniformity bias taken
literally — an inert field is one concept, a withheld field is two — and it is what keeps the
surface to the nine files below. Two of the room's fields are NOT inert, and `produce` says which.

**Status is a bitfield; a subscription is a mask.** 3.3 has reading a probe subscribe to that probe
alone, which naively is seven subscriber lists per node. Instead one list, each edge carrying the
mask of channels it wakes on, and a wake is `(before ^ after) & link.mask` — used BOTH to decide
whether the edge wakes and to decide at what level, because the XOR is a summary of the whole
transition and only the masked part of it is what this reader asked for.

## Files

Under `src/shared/reactive/`. Naming per CLAUDE.md, "writing code".

| File | Exports | Carries |
| --- | --- | --- |
| `REACTIVE_FLAGS.ts` | the status bits, and `CLEARED_BY_A_PRODUCTION` | the constants leaf, no imports of its own |
| `graph.ts` | `Link`, `Reader`, `subscribe`, `wake`, `refresh`, `flushEffects` | tracking, edges, the dirty walk, the effect queue |
| `ReactiveNode.ts` | `ReactiveNode` | value, status, ring, gates, productions |
| `Ring.ts` | `Ring` | `tail` retention, `ttl` expiry, and 5.8's head replacement |
| `comparator.ts` | `comparator` | 5.3's arity discrimination over 5.4's structural default |
| `face.ts` | `face` | the callable a factory hands back |
| `state.ts` / `memo.ts` / `watch.ts` | the three factories | construction, and nothing else |

`channel.ts` and the keyed-memo entry map land later, against the same node.

`flushEffects` rather than `flush` because `SERVER.md` already names a `flush.ts` for the
generator → `ReadableStream` pump. Two mechanisms under one name in two seams is a debugging
trap and neither plan owns the collision, so the reactive one takes the longer name — it is the
one whose subject is in the name rather than in the module.

## The flags

```ts
// REACTIVE_FLAGS.ts
export const PENDING = 1
export const REFRESHING = 2
export const DONE = 4
export const SUCCESS = 8
export const STREAMING = 16
export const ERRORED = 32          // the standing s.error (4.10)
export const PRODUCER_FAILED = 64  // 2.3 throws on read; 2.4 and 2.5 do not
export const STALE = 128           // 7.8
export const VALUE = 256           // never stored; only ever in a changed mask
export const PROPAGATED = PENDING | REFRESHING | DONE // 11.20

// The dirty LEVELS. Not status bits and never in a mask — a separate scale, in the same leaf
// because a constant crossing a seam lives in one file with no imports of its own.
export const CLEAN = 0
export const CHECK = 1
export const DIRTY = 2
```

`ERRORED` and `PRODUCER_FAILED` are two bits because 2.3 and 2.4 disagree: a producer's failure
makes a read throw where nothing has landed, a rejected write never does, and both fill `s.error`.
One bit cannot answer both.

## The graph

```ts
import { CLEAN, CHECK, DIRTY } from './REACTIVE_FLAGS.ts'

export interface Reader {
    run: number                  // bumped per evaluation; an edge not claimed this run is dropped
    dirty: number
    sources: Link | undefined
    sourcesTail: Link | undefined
    cursor: Link | undefined     // how far this run has got along `sources`
    evaluate(): void
    notify(dirty: number): void
}

export class Link {
    constructor(node: ReactiveNode, reader: Reader, mask: number) {
        this.node = node
        this.reader = reader
        this.mask = mask
        this.seen = node.version
        this.claimed = reader.run
        this.nextSource = undefined
        this.nextSubscriber = undefined
        this.prevSubscriber = undefined   // every field at construction; one shape
    }
}

let ACTIVE: Reader | undefined

export function subscribe(node: ReactiveNode, mask: number): void {
    const reader = ACTIVE
    if (reader === undefined) return                       // 14.7, 14.9, 14.10 — not the flow
    const next = reader.cursor === undefined ? reader.sources : reader.cursor.nextSource
    if (next !== undefined && next.node === node) {        // the same edge in the same position
        // The mask is REPLACED on this run's first touch and ORed only within the run. Widening it
        // across runs is a one-way ratchet: a reader that read `s()` once and only `s.pending()`
        // afterwards keeps VALUE forever and wakes on every value change it no longer reads —
        // right output, wasted work, invisible to a correctness test.
        next.mask = next.claimed === reader.run ? next.mask | mask : mask
        next.seen = node.version
        next.claimed = reader.run
        reader.cursor = next
        return
    }
    attach(reader, node, mask)                             // reorder or new edge: scan, else allocate
}

export function wake(node: ReactiveNode, changed: number): void {
    for (let link = node.subscribers; link !== undefined; link = link.nextSubscriber) {
        const woke = link.mask & changed
        if (woke === 0) continue
        // The LEVEL comes from what THIS edge woke on, not from the whole `changed` summary. A
        // settled load transitions SUCCESS|DONE|~PENDING|VALUE in one `enter`, so reading the
        // summary hands DIRTY to a probe-only reader whose mask is PENDING — it re-evaluates
        // against a value it does not read. `changed` BRACKETS the transition; only `woke` says
        // what this reader asked for.
        link.reader.notify((woke & VALUE) !== 0 ? DIRTY : CHECK)
    }
}
```

Subscriber links are doubly linked for O(1) removal; the source list is singly linked and walked in
order, the fast path being that a reader reads the same sources in the same order it did last run.
An edge whose `claimed` is not this run is unlinked at the end of the run.

Three things fall out of this rather than being built:

- **14.13 needs no machinery.** Tracking is a strict push/pop around a *synchronous* segment, so a
  frame is never left on the stack across an `await`, and a continuation always resumes with an
  empty stack. No `AsyncLocalStorage`, and so no `node:` import to justify under CLAUDE.md.
- **5.1 needs the two-colour walk.** A wake pushes `DIRTY` to direct subscribers and `CHECK`
  onward; effects pull at `flushEffects`, a memo recomputes only where a source's `version` moved, and a
  recompute whose identity matches wakes nobody. Pushing eagerly would wake readers for values that
  did not change, which is 5.2 failing silently with the right output on screen.
- **D69's derived probes reuse the reader's own edges.** A memo's `pending()` walks its source list
  and calls each source's probe *while the asking reader is active*, so the subscription lands on
  the reader through ordinary tracking and the memo holds nothing (11.22).

```ts
function propagated(node: ReactiveNode, mask: number, walk: number): boolean {
    const reader = node.reader                 // undefined on a state, a room, a keyed memo (11.25)
    if (reader === undefined) return false
    for (let link = reader.sources; link !== undefined; link = link.nextSource) {
        const source = link.node
        if (source.walk === walk) continue     // a diamond is one node reached twice, not two
        source.walk = walk
        subscribe(source, mask)                // 3.3 — the asker joins that probe alone
        if ((source.status & mask) !== 0) return true
        if (propagated(source, mask, walk)) return true
    }
    return false
}
```

Short-circuiting on the first true source is safe: that source's change is what re-runs the walk,
and the walk re-derives from scratch.

`walk` is a monotonic counter bumped once per probe read, and `node.walk` is a field like any
other — fixed at construction, initialised `0`. Without it the walk is exponential rather than
linear in a diamond: a node reachable by two paths is descended twice, and a chain of k diamonds
is 2^k. The short-circuit hides this exactly when the answer is `true`, so the cost only appears
on the `false` reads, which are the common ones. Note the walk is over `node.reader.sources` while
`subscribe` writes to the ASKING reader's list — two different readers, so the mid-walk
subscription does not perturb the list being iterated.

## The node

```ts
export class ReactiveNode {
    produce(incoming: unknown): unknown {
        if (this.schema !== undefined) {
            try { incoming = this.schema.parse(incoming) }              // 4.3, on the settled value
            catch (thrown) { return this.refuse(validationError(issuesOf(thrown))) }  // 4.5, 15.9
        }
        if (this.transform !== undefined) {
            const shaped = untracked(this.transform, incoming)          // 4.7, 14.10
            if (isFailed(shaped)) return this.refuse(shaped)            // 4.6, 4.9
            incoming = shaped
        }
        const duplicate = (this.status & SUCCESS) !== 0 && this.identity(incoming, this.value)  // 5.2
        if (!duplicate) {
            this.value = incoming
            this.version++
            if (this.headReplaces) this.ring.replaceHead(incoming)      // 5.8, and 5.9 for s.patch
            else this.ring.push(incoming, this.clock)                   // 6.1, 6.3
            this.persist(incoming)                                      // 8.8, 8.10, 8.11
        }
        const changed = this.enter(SUCCESS | this.settles, CLEARED_BY_A_PRODUCTION)
        wake(this, duplicate ? changed : changed | VALUE)               // 4.11, 7.11
        return undefined
    }

    set(incoming: unknown): unknown {
        // 1.7 before 4.1: a `Reactive` is thenable under 1.5, so the brand is read first or
        // every one of them arrives here as a load.
        if (isReactive(incoming)) return this.produce(incoming)
        return isThenable(incoming) ? this.load(incoming) : this.produce(incoming)  // 4.1, 4.2
    }

    private load(promise: Promise<unknown>): undefined {
        const epoch = ++this.epoch                     // a settled load from an older epoch is dropped
        const serving = (this.status & (SUCCESS | STALE)) === SUCCESS   // 3.14, and 7.9 for the stale arm
        wake(this, this.enter(serving ? REFRESHING : PENDING, serving ? 0 : DONE))
        promise.then(
            settled => { if (epoch === this.epoch) this.produce(settled) },
            thrown => { if (epoch === this.epoch) this.fail(thrown) },
        )
        return undefined
    }

    private enter(set: number, clear: number): number {
        const status = (this.status | set) & ~clear
        const changed = status ^ this.status
        this.status = status
        return changed
    }
}
```

`enter` is the whole probe machinery: an OR, an AND-NOT and an XOR, and the result is the wake mask.
`isThenable` ahead of `await` is CLAUDE.md's rule — a write is a per-interaction path, and a settled
write must not buy a promise wrap and a microtask tick. `isReactive` ahead of `isThenable` is 1.7,
and it is the whole cost of D95: once 1.5 makes a `Reactive` thenable, the thenable test alone no
longer tells a load from a value.

`identity` is the name REGISTRY gives the option and 5.3 DISCRIMINATES IT BY ARITY: one parameter is
a projection compared by `!==`, two is a comparator answering directly. The node cannot call the
author's function raw — a one-parameter `v => v.id` invoked as `identity(incoming, previous)` returns
the id, which is truthy, and every write after the first is swallowed as a duplicate with the right
value still on screen. So `this.identity` is a two-argument comparator NORMALISED ONCE at
construction from `fn.length`, over 5.4's structural default — `comparator.ts` in the table above,
which exists for that one discrimination.

A DUPLICATE STILL TRANSITIONS. 5.2 says a matching production must not be retained and must wake no
reader; it says nothing about the probes, and a probe reader is not a reader under the Terms table.
Returning early from the whole method is what makes `s.set(fetchSameThing())` leave `PENDING` set
forever, against 2.12, 3.14, 7.9 and 7.11 — an accepted production, which this is, MUST clear the
stale mark. So the early return skips retention, the version bump and `persist`, and nothing else.

`CLEARED_BY_A_PRODUCTION` is `PENDING | REFRESHING | STREAMING | STALE | ERRORED | PRODUCER_FAILED`,
in the flags leaf. `REFRESHING` and `STREAMING` have to be in it: `load` sets `REFRESHING` and 7.5
has `s.refreshing` true only WHILE the reload is in flight, and 8.7 has a restored stream report
`s.streaming` false. Neither is cleared anywhere else, so leaving either out latches the probe true
for the life of the node.

`headReplaces` and `settles` ARE THE ROOM'S TWO REAL ARMS, and they are the place the "inert field"
framing above does not reach. 5.8 has `s.set` replace the head production on a room and mint no
sequence number, and 3.9 has `s.done` remain false while a room is live — so a uniform
`ring.push` and a uniform `SUCCESS | DONE` are not an inert option on a room, they are the wrong
status and the wrong retention. CLAUDE.md's uniformity bias is about an option that does nothing on
one producer, not about a shared path that produces a wrong answer there; both fields are decided at
construction and read, never branched on per write.

`serving` is 3.14 written once: refreshing over a landed value, pending where nothing has landed or
7.9's stale mark is set. It is scoped to `s.set`, and a re-adoption reaches it by 11.16 and 11.19
instead (D84).

## The face

```ts
const FACE = Object.assign(Object.create(Function.prototype), { set, patch, peek, pending, /* … */ })

export function face(node: ReactiveNode) {
    const read = () => node.read()
    Object.setPrototypeOf(read, FACE)   // prototype BEFORE the own property, or the shape mutates
    read.node = node
    return read
}
```

One closure and two property writes per `Reactive`, rather than ~20 own properties or a `Proxy`.
The order is load-bearing: `setPrototypeOf` after an own-property write transitions an object that
already has a shape, and this object is called per row from a template slot. Setting the prototype
first means the own property lands on a shape that is already final.

A closure rather than a class instance because a `Reactive` must be CALLABLE (1.1) — `read()` is
the read — and the only way to a callable with a prototype chain is a function object. What the
hot-path rule bans is a closure that keeps its enclosing scope alive; this one captures exactly one
binding, `node`, which the object needs for its whole lifetime anyway.

Members read `this.node`, so an extracted `const p = s.pending` loses its receiver — the compiler
always emits the call form and `watch(s, …)` passes the face itself, but that wants a lint rather
than being left implicit. `s.node` is reachable from application source and is not a name an app
author should write; it owes a REGISTRY row saying so, and the lint owes a clause. Both are in
"What the docs owe" below.

## Build order

Each phase is gated by the one before it, and the ordering is not arbitrary: the ring is what a
window buffers into (D68), so windows cannot land before retention; adoption is delegation to a
`Reactive` (D43), so it cannot land before there is one.

| Phase | Lands | Clauses |
| --- | --- | --- |
| 0 | the vanilla arm, and the share measurement below | — |
| 1 | graph, node, `state`, `watch` | 1.1, 1.3–1.7, 2.1–2.6, 2.12–2.13, 3.1–3.5, 3.10, 3.11, 3.13, 3.14, 4.1–4.13, 5.1–5.10, 12.x, 14.x |
| 2 | `Ring` — `tail`, `ttl`, cursors | 2.8, 2.9, 2.11, 6.x |
| 3 | unkeyed `memo`, propagated probes, triggers | 7.x, 11.1, 11.5, 11.20–11.22, 11.61 |
| 4 | keyed `memo` — `Args` canonicalisation, entries | 11.2–11.4, 11.6, 11.26–11.33, 11.52, 11.55–11.56, 11.61, 11.62 |
| 5 | adoption | 11.12–11.19, 11.57–11.58 |
| 6 | `channel`, rooms | 9.x |
| 7 | stores | 8.x |
| 8 | `throttle` and `debounce` | 5.11–5.19 |
| 9 | selections | 13.x |

Server-side behaviour cuts across all of it — 14.12's sink-registering reader, 12.6's run-once
`watch`, 35.7's sinks — and lands with SSR rather than as a branch inside a read. The server pushes
a different `Reader` onto the same stack, so nothing in `subscribe` learns which side it is on.

## The vanilla arm, and what a ratio here is worth

CLAUDE.md records that two rewrites of the reactive core landed as no-ops because the path they
improved is 0.055 of a 1.45 ms op, and that the same graph reads 1.67x a hand-written signal under
JSC and 0.21x under V8 — inverted, not scaled. So:

* Phase 0 writes the arm first: `let value; const subscribers = []`, hand-written, in
  `harness/measure`, which has no abide in its graph.
* The share gets written down before any of this is optimised — MEASURED here, not quoted. The
  0.055/1.45 ms figure above is the share the two FAILED rewrites turned out to hold; it is
  evidence that this layer is usually small, not a measurement of this design. What phase 0 owes is
  the reactive layer's own fraction of one named op on the dogfood app, with the op and the n
  written down: the 500-row patch-transform reorder is the case, and the number to beat is whatever
  fraction of its click-to-paint the graph walk actually holds.
* **This design is held to allocation count and clause coverage, not to ms** — with the caveat that
  a prediction is not a result. Saying in advance that a level ratio is "the expected answer" is
  the falsifier being removed, so phase 0 states a THRESHOLD instead: if the reactive layer's
  share of the named op exceeds 10%, the ms arm comes back on the table and the design is
  re-argued. Below that, allocations and clause coverage are the budget.
* Both substrates or neither. Phase 0 schedules the JSC arm under `bun test` AND the V8 arm under
  the playwright project, because CLAUDE.md's own figure has them inverted rather than scaled — one
  arm is not a weaker version of the answer, it is a different answer.

## Work gates

Each is a "does less work" contract, so a correctness test cannot guard it: the wrong
implementation still produces the right output. Every one is verified by reverting the mechanism and
watching it fail, and the number it reports with the mechanism out is what the gate is worth.

| Asserts | Revert that must break it | What it reports with the mechanism out |
| --- | --- | --- |
| a reader of `s.pending()` alone does not wake on a value change | one subscriber list instead of the mask | 0 → 1 wake |
| a reader whose read set SHRINKS between runs stops waking on what it dropped | `next.mask \|= mask` — widen the claimed edge across runs | 0 → 1 wake per subsequent write |
| a probe-only reader woken by a settled load re-runs its body zero times | take the level from `changed` rather than `link.mask & changed` | 0 → 1 body run |
| a memo recompute yielding an equal identity wakes zero effects | push eagerly rather than the CHECK walk | 0 → every downstream effect |
| an unkeyed memo holds zero probe subscriptions while `pending()` still goes true | a subscription per source for probes (11.22) | 0 → 1 per source |
| a probe over k stacked diamonds descends 2k nodes, not 2^k | drop `source.walk` from `propagated` | k=8: 16 → 256 descents |
| `ttl` expiry on a ring wakes no reader (6.4) | wake on eviction as well as on production | 0 → 1 wake per expiry |
| a second consecutive rejection still wakes a reader of `s.error` | leave `ERRORED` latched across `load` | 1 → 0 wakes, stale error on screen |
| per-write ns at `tail: 4096` is within 1.05x of `tail: 4` | rebuild retention per write rather than append (6.2) | 1.0x → ~1000x |
| probing an uncomputed key leaves the entry map the same size | get-or-create on the probe path (11.62) | 0 → 1 entry |
| a read with a stable dependency allocates nothing | allocate a `Link` per read rather than reusing | 0 → 1 `Link` per read |

## Budget

Filled in at landing, from the arm rather than from a profiler's summary. The three numbers
CLAUDE.md asks for are allocations per template node, microtask ticks per row, DOM nodes per list
item; these are the reactive core's own half of that.

| | Target |
| --- | --- |
| allocations, read with a stable dependency | 0 |
| allocations, read that adds an edge | 1 `Link` |
| allocations, production | 1 ring slot |
| microtask ticks, settled write | 0 |
| subscriber walk, wake | readers whose mask intersects, and no others |
| LOC over the vanilla arm | measured at phase 1, stated out loud |
| exported names added | 15 across nine files — the machinery budget's second number |
| branches added to a shared path | counted on `produce`/`set`/`subscribe`, the three every write walks |

The last two rows are not decoration. CLAUDE.md budgets machinery as LOC over vanilla, exported
names added, AND branches added to a shared path, and this plan takes ms off the table below — so
the triple IS the budget here, not a supplement to a timing claim. `produce` in particular gains a
branch per option (schema, transform, duplicate, `headReplaces`, `serving`) and every write pays
the walk whether or not the option is set; if that count climbs past what the vanilla arm needs,
the uniformity bias has been paid for in the wrong currency.

## What the docs owe

This is the section every other plan has and this one did not, which is why 124 distinct citations
sat here with no ledger against them. Nothing below is decided; each is a thing this plan would
have to land somewhere gated before the code does.

**RULEBOOK.** Numbers are NOT pre-allocated here — group 42 is `The app object` and 43 is spoken
for by `COMPILER.md`, so these take real numbers at landing and a plan is not the place to spend
one.

* **A duplicate still transitions.** A write of an equal value still moves `PENDING`/`DONE` even
  where 5.2 stops the value propagation. Refuses the reading where `identity` gates the whole
  transition rather than the value channel alone.
* **`ERRORED` and `PRODUCER_FAILED` are two channels, not one.** 2.3 makes a read throw where a
  producer failed and nothing has landed; 2.4 and 2.5 do not. Both fill `s.error`. Refuses one bit.
* **The wake level is per edge.** A reader is woken at the level of what ITS mask intersects, not
  at the level of the whole transition. This is the fix above and it is a requirement, not a
  sequencing note.
* **A lint for an extracted member.** `const p = s.pending` loses its receiver. Owes a clause and a
  surface on `abide check`.

**REGISTRY.**

* `s.node` — reachable from application source, not a name an app author writes. It owes a row
  saying so, or the face owes a spelling that is not reachable at all.

**DECISIONS.** Each of the three RULEBOOK proposals above names an alternative it refused, so each
owes an entry.

## Still undecided

* **Where a scope lives.** 10.5 has `state.share` scoped to the component instance and its
  descendants, 11.34 has an unkeyed memo request-local on a server, 13.8 has a `Selection`
  scope-bounded. One owner mechanism should serve all three, and this plan does not yet say what it
  is or where the stack for it lives.
* **What a `Schema` is at the call site.** `schema.parse` is written above as a placeholder; 19.16
  and P1 govern the widening once `COMPILER.md` lands — 19.13 and D22 are what govern it TODAY, and
  that plan withdraws the one and reverses the other, so this bullet moves with it. Three call
  shapes are already assumed across the plans (`schema.parse(incoming)` here, "derived from the
  annotation and the argument defaults" in COMPILER, "coerces from the `JsonSchema` before
  validating" in SERVER) and they are not obviously the same shape.
* **Which of the three accumulation variants a `channel` uses.** CLAUDE.md names them — version +
  lazy snapshot where writes dominate, a structural compare that KEEPS the old identity where reads
  dominate, a cursor where the reader consumes in order — and says the read/write ratio decides.
  `Ring` carries push and head-replacement above and says nothing about how a read materialises a
  snapshot, which is the whole of the decision. Deciding it needs the ratio measured on the dogfood
  app's own channels, not argued.
* **Where the component-instance scope stack lives.** Listed here under 10.5, and `RENDERER.md`
  runs `state('')` inside a component body without a stack of any kind — the item is on this list
  and on no other, while the plan that needs it does not know it is open.
* **Whether `Link` reuse across runs wants a free list.** A reorder allocates a duplicate edge and
  drops the stale one at end of run. It self-heals, and whether the garbage matters is a
  measurement rather than an argument.
