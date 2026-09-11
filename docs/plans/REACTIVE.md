# Reactive core — implementation plan

*Status: not landed. Nothing in this file is decided.* A plan is not a fifth governed document —
where it disagrees with RULEBOOK, REGISTRY or DECISIONS, those win and this is stale. Its job is to
carry the part sixteen clauses cannot: what the code looks like, in what order it lands, and what
number would falsify it.

## What this is

An implementation of REGISTRY's "Reactive primitives" — `state`, `memo`, `channel`, `watch`,
selections, tracking, and the refusals they produce — against RULEBOOK 1–15. The framework has no
reactive code today (`src/shared/index.ts` is `export {}`), so this is the first landing rather
than a refactor.

Groups 1–15 hold **250 clauses, 16 withdrawn, 234 live**. The build order below schedules every
live one, and names the plan that owns the seven it hands away.

## The shape

**One node type, three faces.** 1.1 has every producer hand back a `Reactive`, so `state`, `memo`
and `channel` are three FACTORIES over one `ReactiveNode` — one constructor, one initialisation
order, every field written including `undefined`. Not "three constructors differing in which fields
are filled": that is three hidden classes on the object every production writes, and `this.status`
goes polymorphic in `enter` and `wake`. The uniformity bias argues for the single shape, not
against it. `ReactiveNode`'s full field list is below and is a phase 0a deliverable, for the reason
`SERVER.md` enumerates `Call`'s nine and `Scope`'s ten.

A room is a node whose `identity` defaults to the reference (5.5) and whose triggers are inert
(7.13); a memo is a node that additionally owns a `Reader`. Three of the room's fields are NOT
inert, and `produce` says which.

**Status is a bitfield; a subscription is a mask.** 3.3 has reading a probe subscribe to that probe
alone, which naively is seven subscriber lists per node. Instead one list, each edge carrying the
mask of channels it wakes on, and `link.mask & changed` decides WHETHER the edge wakes.

**It does not decide at what LEVEL.** An earlier revision took the level from the masked XOR —
`VALUE` meant `DIRTY`, anything else `CHECK` — and that is a defect, not a refinement. `CHECK` is
resolved by revalidating against a source's `version`, `version` bumps only on a value production,
and therefore no probe transition could ever validate: `s.set(fetchUser())` set `PENDING`, notified
`CHECK`, found the version unmoved and dropped the reader back to clean. The spinner never
appeared. The same hole swallowed `s.refresh()`, `s.invalidate()`, `fail()` and a duplicate settle
— four of the five probe transitions — and the only one that worked did so through the value's
version, by accident.

`DIRTY`/`CHECK` is the DIRECT/TRANSITIVE axis, which is what the two-colour walk is for. An edge
that woke on a bit it explicitly subscribed to is the definition of `DIRTY`. So `wake` notifies
`DIRTY`, a memo pushes `CHECK` onward to its own subscribers, and validation reads two tokens
rather than one — `version` for the value channel, `pulse` for the status channels. **The mask is a
summary of a transition and `version` is a token for a value; resolving one against the other is
the bug.**

## Files

Under `src/shared/reactive/` except where noted. Naming per CLAUDE.md, "writing code".

| File | Exports | Carries |
| --- | --- | --- |
| `REACTIVE_FLAGS.ts` | the status bits, `CLEARED_BY_A_PRODUCTION`, `CLEARED_BY_A_SETTLE`, `PROPAGATED` | the constants leaf, no imports of its own |
| `#shared/guards.ts` | `isReactive`, `isThenable`, `isFailed` | the one implementation of 1.7's ordering. `camelCase` because a leaf is UPPERCASE **and import-free**, and `isReactive` reads the brand — `conventions.test.ts` selects on filename casing alone |
| `graph.ts` | `Link`, `Reader`, `subscribe`, `attach`, `wake`, `revalidate`, `flushEffects`, `untracked` | tracking, edges, the dirty walk, the effect queue |
| `propagated.ts` | `propagated` | D69's derived probes, iterative and cycle-safe |
| `counters.ts` | `WORK`, `publishWork` | 44.25's `__ABIDE_WORK__` record and the dev flag that installs it |
| `ReactiveNode.ts` | `ReactiveNode` | value, status, ring, gates, productions — one constructor |
| `Ring.ts` | `Ring` | `tail` retention, `ttl` expiry, cursors, and 5.8's head replacement |
| `comparator.ts` | `comparator`, `structural` | 5.3's arity discrimination over 5.4's structural default; `structural` is a REGISTRY name an app writes |
| `validate.ts` | `validate` | the three arms of `Schema<T>` — see "The schema call" |
| `refusals.ts` | `Failed`, `validationError`, `refuse` | group 15, which phase 1's `produce` already calls into |
| `face.ts` | `face` | the callable a factory hands back |
| `state.ts` / `memo.ts` / `watch.ts` | the three factories | construction, and nothing else |

`channel.ts` and the keyed-memo entry map land later, against the same node.

`flushEffects` rather than `flush` because `SERVER.md` already names a `flush.ts` for the
generator → `ReadableStream` pump. Two mechanisms under one name in two seams is a debugging
trap and neither plan owns the collision, so the reactive one takes the longer name — it is the
one whose subject is in the name rather than in the module.

`revalidate` rather than `refresh`, by the same argument applied once more and INSIDE this seam:
REGISTRY spends `refresh` twice already — the `Selection` form (13.4, 13.7, 13.10) and `s.refresh`
/ `m.refresh` (7.4, 7.5) — and both land in this package. The dirty walk is a third mechanism and
was about to take the name.

`guards.ts` is in `#shared` and not here because `SERVER.md` and `RENDERER.md` both say they import
it rather than re-derive it — "three implementations of a two-line test is how one of them ends up
in the wrong order". No plan's file table contained it, which is how that outcome arrives.

## The flags

```ts
// REACTIVE_FLAGS.ts
export const PENDING = 1
export const REFRESHING = 2
export const DONE = 4
export const SUCCESS = 8
export const STREAMING = 16
export const ERRORED = 32          // the standing s.error (4.10, 4.11)
export const PRODUCER_FAILED = 64  // 2.3 throws on read; 2.4 and 2.5 do not
export const STALE = 128           // 7.8
export const VALUE = 256           // never stored; only ever in a changed mask
export const PROPAGATED = PENDING | REFRESHING | DONE // 11.20

// The dirty LEVELS. Not status bits and never in a mask — a separate scale, in the same leaf
// because a constant crossing a seam lives in one file with no imports of its own.
export const CLEAN = 0
export const CHECK = 1
export const DIRTY = 2

// IN FLIGHT is what a settle of any kind ends, and it is cleared on FOUR paths, not one.
export const IN_FLIGHT = PENDING | REFRESHING | STREAMING
export const CLEARED_BY_A_PRODUCTION =
    IN_FLIGHT | STALE | ERRORED | PRODUCER_FAILED
export const CLEARED_BY_A_SETTLE = IN_FLIGHT
```

`ERRORED` and `PRODUCER_FAILED` are two bits because 2.3 and 2.4 disagree: a producer's failure
makes a read throw where nothing has landed, and a rejected write never does. That both of them
fill `s.error` is the half RULEBOOK does not carry — `grep 's\.error' docs/RULEBOOK.md` returns the
Terms row, 3.10, 4.10 and 4.11, and **4.10 is scoped to a REFUSED WRITE**. Nothing says a failed
producer fills `s.error`. The two-bit split is right and its second premise is undecided; see "What
the docs owe".

`CLEARED_BY_A_SETTLE` is the fix for a defect the single list carried: `CLEARED_BY_A_PRODUCTION`
was applied in `produce` only, so both `refuse` paths and `fail` returned before reaching it. A
load that resolved with a payload the schema rejected left `PENDING` set **for the life of the
node** — the spinner spinning with the error already in `s.error`. A settle of any kind ends the
in-flight bits; only an ACCEPTED production also clears `STALE` and the error pair.

`STREAMING` is in `IN_FLIGHT` and that is a claim about the chunk path, which this plan does not
sketch. If a chunk reaches `produce`, 3.6, 3.15, 4.8 and 5.2 all break at once — the first chunk
clears `PENDING`, the `transform` runs per chunk against 4.8, and 5.2's duplicate gate silently
drops a repeated frame from the stream. The chunk path is therefore NOT `produce`, it is phase 8's,
and this leaf is what it has to be checked against.

## The graph

```ts
import { CHECK, DIRTY, VALUE } from './REACTIVE_FLAGS.ts'

export interface Reader {
    kind: number                 // 12.1 effect | memo | server sink — ONE class, a kind field
    run: number                  // bumped per evaluation; an edge not claimed this run is dropped
    dirty: number
    sources: Link | undefined
    sourcesTail: Link | undefined
    cursor: Link | undefined     // how far this run has got along `sources`
    highWater: Link | undefined  // the furthest the cursor reached — see `attach`
    queued: Reader | undefined   // the effect queue link; no array, no per-flush allocation
    sink: unknown                // 14.12's sink, `undefined` off a server
    scope: unknown               // 10.5 / 11.34 / 12.5's owner, phase 4
    stopped: boolean             // 12.9
    evaluate(): void
    notify(level: number): void
}
```

`kind` rather than three implementations of `notify`: `wake`'s call to `link.reader.notify` is the
hottest call site in the design, and three classes behind it is a megamorphic dispatch in the loop
every write walks. This is the uniformity bias where it pays.

`sink` and `scope` are `undefined` off a server and outside a scope, which is the inert-field shape
— not a reason to withhold them. They are declared here because a `Reader` gains neither on a later
path: the shape is fixed at construction.

```ts
export class Link {
    node: ReactiveNode
    reader: Reader
    mask: number
    seen: number        // node.version at the last claim — the VALUE channel's token
    seenPulse: number   // node.pulse at the last claim — the STATUS channels' token
    claimed: number
    nextSource: Link | undefined
    nextSubscriber: Link | undefined
    prevSubscriber: Link | undefined

    constructor(node: ReactiveNode, reader: Reader, mask: number) {
        this.node = node
        this.reader = reader
        this.mask = mask
        this.seen = node.version
        this.seenPulse = node.pulse
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
        claim(reader, next, mask)
        reader.cursor = next
        if (reader.highWater === undefined || reader.highWater === next.prevSource)
            reader.highWater = next
        return
    }
    attach(reader, node, mask)
}

// The mask is REPLACED on this run's first touch and ORed only within the run. Widening it
// across runs is a one-way ratchet: a reader that read `s()` once and only `s.pending()`
// afterwards keeps VALUE forever and wakes on every value change it no longer reads —
// right output, wasted work, invisible to a correctness test.
function claim(reader: Reader, link: Link, mask: number): void {
    link.mask = link.claimed === reader.run ? link.mask | mask : mask
    link.seen = link.node.version
    link.seenPulse = link.node.pulse
    link.claimed = reader.run
}
```

`claim` is extracted because `attach` needs the identical rule and an earlier revision had it
inline in the fast path only — which put the OR on the one branch that could not reach it. After
the fast path sets `reader.cursor = next`, a SECOND read of the same node in the same run computes
`next = cursor.nextSource`, which is the FOLLOWING source, so `next.node === node` is false and
control leaves for `attach`. Every within-run second touch of a node took the branch where the
widening rule was not written.

That is not a corner case, it is D69's own mechanism: `propagated` subscribes the asking reader to
a probed memo's sources, so `{#if items.pending()}{rows()}` touches `rows` twice in one run — once
with `PENDING` through the walk, once with `VALUE` through the template. Replace rather than OR and
the reader either never wakes on pending again, or never re-renders on a value change, depending on
the read order.

```ts
export function attach(reader: Reader, node: ReactiveNode, mask: number): void {
    // A reorder: the edge exists somewhere ahead. Scan from the cursor to the high-water mark,
    // never from `sources` — a backward scan would move the cursor behind an edge already
    // claimed this run, and the end-of-run sweep would then drop a live edge.
    for (
        let link = reader.cursor === undefined ? reader.sources : reader.cursor.nextSource;
        link !== undefined;
        link = link.nextSource
    ) {
        if (link.node !== node) continue
        claim(reader, link, mask)
        reader.cursor = link
        if (link === reader.highWater) reader.highWater = link
        return
    }
    // A second touch of a node already claimed BEHIND the cursor. Widen in place and do not
    // move the cursor: the position is already correct for the source order this run read.
    for (let link = reader.sources; link !== undefined && link !== reader.cursor; link = link.nextSource) {
        if (link.node !== node || link.claimed !== reader.run) continue
        link.mask |= mask
        return
    }
    const link = new Link(node, reader, mask)      // genuinely new: the only allocation
    append(reader, link)
    link.nextSubscriber = node.subscribers
    if (node.subscribers !== undefined) node.subscribers.prevSubscriber = link
    node.subscribers = link
    reader.cursor = link
    reader.highWater = link
    WORK.links++
}
```

Three arms, and the middle one is the whole of the "0 allocations on a stable dependency" claim.
An earlier revision delegated all three to an unwritten `attach` and asserted the outcome in a
gate, which is the shape CLAUDE.md warns about — a gate written green against code nobody wrote.

**The sweep runs from `highWater`, not from `cursor`.** At end of run, every link between
`highWater.nextSource` and `sourcesTail` was not reached this run and is unlinked; links behind the
high-water mark whose `claimed` is not this run are unlinked in the same pass. Sweeping from the
cursor alone drops a live edge whenever a reader reads `a(), b(), a()` — the cursor ends at `a`,
and `b` is swept despite having been read.

```ts
export function wake(node: ReactiveNode, changed: number): void {
    for (let link = node.subscribers; link !== undefined; ) {
        // Read the successor BEFORE calling out: a server `Reader` (12.6) evaluates
        // synchronously from `notify`, re-subscribes, and its end-of-run sweep can unlink
        // the link we are standing on. The rest of the list would then never be woken.
        const next = link.nextSubscriber
        if ((link.mask & changed) !== 0) {
            WORK.wakes++
            link.reader.notify(DIRTY)   // this edge asked for this channel. That is DIRTY.
        }
        link = next
    }
}
```

Subscriber links are doubly linked for O(1) removal; the source list is singly linked and walked in
order, the fast path being that a reader reads the same sources in the same order it did last run.

`wake` is not called where `changed === 0`. A duplicate write and a redundant `load` both flip no
bit, and walking the whole subscriber list to `continue` on every entry is O(subscribers) for
nothing on a per-frame path. The callers below test before calling.

`revalidate` resolves a `CHECK` reader against BOTH tokens, per edge and per mask:

```ts
function stale(link: Link): boolean {
    const node = link.node
    if ((link.mask & VALUE) !== 0 && link.seen !== node.version) return true
    if ((link.mask & ~VALUE) !== 0 && link.seenPulse !== node.pulse) return true
    return false
}
```

One token cannot serve both channels, and an earlier revision had only `version`. `pulse` is
bumped by `enter` on every transition that changed anything, `version` only by an accepted value
production — which is exactly 5.1 and 5.2's distinction made checkable.

Three things fall out of this rather than being built:

- **14.13 needs no machinery ON THE CLIENT.** Tracking is a strict push/pop around a *synchronous*
  segment, so a frame is never left on the stack across an `await`. On a server it is not free:
  `RENDERER.md`'s `stream` is an async generator that reads between `yield`s, and a `Reader` pushed
  for the duration of a render is on a module-level `ACTIVE` across every suspension point — two
  concurrent renders then subscribe each other's reads. Phase 5 owns this and the answer is a
  per-read push/pop driven by the emitted code, NOT an `AsyncLocalStorage`; `SERVER.md` makes the
  opposite call for the scope and the two must be read together.
- **5.2 forbids the eager push.** A wake marks direct subscribers `DIRTY` and a memo pushes `CHECK`
  onward; effects pull at `flushEffects`, a memo recomputes only where `stale()` says a source
  moved, and a recompute whose identity matches wakes nobody. Pushing eagerly would wake readers
  for values that did not change, which is 5.2 failing silently with the right output on screen.
  (5.1 is a PROPERTY — "woken only when read identity changes" — and an eager push that compares
  before waking satisfies it too. 5.2 is the clause that forbids the mechanism.)
- **D69's derived probes reuse the reader's own edges.** A memo's `pending()` walks its source list
  and calls each source's probe *while the asking reader is active*, so the subscription lands on
  the reader through ordinary tracking and the memo holds nothing (11.22).

```ts
// propagated.ts — ITERATIVE. The recursive form had unbounded depth on a memo chain, on a path
// walked per probe read per row per frame, and 3.1 says a probe MUST NOT throw — a stack
// overflow inside `s.pending()` is that throw. CLAUDE.md asks for a loop here for the same reason.
export function propagated(node: ReactiveNode, mask: number, walk: number): boolean {
    const stack: ReactiveNode[] = [node]
    while (stack.length > 0) {
        const reader = stack.pop()!.reader   // undefined on a state, a room, a keyed memo (11.25)
        if (reader === undefined) continue
        // Snapshot the source list before subscribing: `subscribe` writes to the ASKING reader,
        // which is a different reader UNLESS the probed graph reaches back to it. A cycle then
        // mutates the list under the walk, and `source.walk` bounds the recursion without
        // bounding that. Copying one level is O(sources) on a path that already is.
        for (let link = reader.sources; link !== undefined; link = link.nextSource) {
            const source = link.node
            if (source.walk === walk) continue   // a diamond is one node reached twice, not two
            source.walk = walk
            WORK.descents++
            subscribe(source, mask)              // 3.3 — the asker joins that probe alone
            if ((source.status & mask) !== 0) return true
            stack.push(source)
        }
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
on the `false` reads, which are the common ones.

**The count is not the cost, and this plan owes the second number.** `{#if m.pending()}` inside a
500-row list walks the transitive source graph 500 times a frame. 11.22 buys "hold no subscription"
at that price, and the gate below counts descents without ever pricing the read. CLAUDE.md is
explicit that a count motivating a change must be converted to a cost before the change is written;
here the mechanism is already chosen by 11.22, so what is owed is the ns per probe read at the n
where it crosses a frame, stated beside the descent count.

## The node

```ts
export class ReactiveNode {
    produce(incoming: unknown): unknown {
        this.epoch++                                                    // supersedes any load in flight
        if (this.schema !== undefined) {
            const validated = untracked(validate, this.schema, incoming)  // 4.3, 14.10
            if (isFailed(validated)) return this.refuse(validated)        // 4.5, 15.9
            incoming = validated
        }
        if (this.transform !== undefined) {
            const shaped = untracked(this.transform, incoming)          // 4.7, 14.10
            if (isFailed(shaped)) return this.refuse(shaped)            // 4.6, 4.9
            incoming = shaped
        }
        // `identity` is the author's function and can read a `Reactive`; untracked, or a write
        // performed inside a live reader run plants an edge on that reader. 14.10's hazard, and
        // the `untracked` on the neighbouring line is what makes its absence here inconsistent.
        const duplicate =
            this.gated && (this.status & SUCCESS) !== 0 &&
            untracked(this.identity, incoming, this.value)                  // 5.2, and 5.5 on a room
        if (!duplicate) {
            this.value = incoming
            this.version++
            if (this.headReplaces) this.ring.replaceHead(incoming)      // 5.8, and 5.9 for s.patch
            else this.ring.push(incoming, this.sequence)                // 6.1, 6.3
        }
        const changed = this.enter(SUCCESS | this.settles, CLEARED_BY_A_PRODUCTION)
        const woke = duplicate ? changed : changed | VALUE
        if (woke !== 0) wake(this, woke)                                // 4.11, 7.11
        // AFTER the transition and the wake: `persist` is application code (8.8, 8.10, 8.11) and
        // can throw. Running it between the value commit and the status commit leaves a node with
        // a new value, a bumped version, the old status and no wake — readers hold the stale value
        // and the next unrelated CHECK validates against the bumped version and re-runs them with
        // a value they were never woken for.
        if (!duplicate) this.persist(incoming)
        return undefined
    }

    // 5.9 has `s.patch` MINT a production, and REGISTRY has it mutate IN PLACE. So `incoming` is
    // `this.value` — the same reference, already mutated — and the duplicate gate answers "equal"
    // for every patch under 5.4's structural default. Routed through `produce`, every `s.patch`
    // changed the value and woke nobody, `rows.patch(r => r.reverse())` included, which is this
    // plan's own named benchmark op. A patch has no separate incoming value to compare, so it does
    // not reach the gate at all. That a patch is never a duplicate is owed a clause.
    patch(mutate: (value: unknown) => void): undefined {
        this.epoch++
        untracked(mutate, this.value)                                   // 5.9, 5.10
        this.version++
        this.ring.replaceHead(this.value)                               // 5.9
        const changed = this.enter(SUCCESS | this.settles, CLEARED_BY_A_PRODUCTION)
        wake(this, changed | VALUE)
        this.persist(this.value)
        return undefined
    }

    set(incoming: unknown): unknown {
        // 1.7 before 4.1: a `Reactive` is thenable under 1.5, so the brand is read first or
        // every one of them arrives here as a load.
        if (isReactive(incoming)) return this.produce(incoming)
        return isThenable(incoming) ? this.load(incoming) : this.produce(incoming)  // 4.1, 4.2
    }

    private load(promise: Promise<unknown>): undefined {
        const epoch = ++this.epoch
        const serving = (this.status & (SUCCESS | STALE)) === SUCCESS   // 3.14, and 7.9 for the stale arm
        const changed = this.enter(serving ? REFRESHING : PENDING, serving ? 0 : DONE)
        if (changed !== 0) wake(this, changed)
        promise.then(
            settled => { if (epoch === this.epoch) this.produce(settled) },
            thrown => { if (epoch === this.epoch) this.fail(thrown) },
        )
        return undefined
    }

    private refuse(failed: unknown): unknown {
        this.error = failed                                             // 4.10
        this.errors++
        wake(this, this.enter(ERRORED, CLEARED_BY_A_SETTLE) | ERRORED)
        return failed
    }

    private fail(thrown: unknown): undefined {
        this.error = thrown
        this.errors++
        const producerFailed = (this.status & SUCCESS) === 0 ? PRODUCER_FAILED : 0   // 2.3 vs 2.4
        wake(this, this.enter(ERRORED | producerFailed, CLEARED_BY_A_SETTLE) | ERRORED)
        return undefined
    }

    private enter(set: number, clear: number): number {
        const status = (this.status | set) & ~clear
        const changed = status ^ this.status
        this.status = status
        if (changed !== 0) this.pulse++
        return changed
    }
}
```

`enter` is the whole probe machinery: an OR, an AND-NOT, an XOR and a pulse, and the result is the
wake mask. `isThenable` ahead of `await` is CLAUDE.md's rule — a write is a per-interaction path,
and a settled write must not buy a promise wrap and a microtask tick. `isReactive` ahead of
`isThenable` is 1.7, and it is the whole cost of D95: once 1.5 makes a `Reactive` thenable, the
thenable test alone no longer tells a load from a value.

**`ERRORED` is forced into the changed mask the way `VALUE` is.** `enter` reports a TRANSITION, and
a second consecutive rejection is `ERRORED` set → set, whose XOR is zero: the reader kept rendering
the first error while the second sat in `s.error`. The mask has no channel for "same bit, new
payload", and the two places that is true are the value (which has `version`) and the error (which
now has `errors`). Forcing the bit is the same move `produce` already makes for a duplicate-free
write, and it is why the old gate row asserting "1 → 0 wakes" was asserting the bug.

**The epoch is bumped by every write, not only by another load.** `++this.epoch` in `load` alone
left `s.set(slowFetch()); s.set(5)` with the stale async value landing over the newer synchronous
one eight hundred milliseconds later, and the same hole let a rejection fire `fail` against a node
holding a good value. Any write supersedes a load in flight; `produce` and `patch` bump it too.

`identity` is the name REGISTRY gives the option and 5.3 DISCRIMINATES IT BY ARITY: one parameter is
a projection compared by `!==`, two is a comparator answering directly. The node cannot call the
author's function raw — a one-parameter `v => v.id` invoked as `identity(incoming, previous)` returns
the id, which is truthy, and every write after the first is swallowed as a duplicate with the right
value still on screen. So `this.identity` is a two-argument comparator NORMALISED ONCE at
construction from `fn.length`, over 5.4's structural default — `comparator.ts` in the table above,
which exists for that one discrimination.

**5.4's structural default is an unbounded deep compare per write, and it is unbudgeted.** On the
500-row array this plan proposes to measure, every `set` deep-compares 500 rows before deciding
whether to wake — plausibly larger than the entire graph walk whose share phase 0b is written to
find. If the reactive layer's share crosses the threshold, this is the first place to look, and it
is a row in the budget rather than a footnote.

A DUPLICATE STILL TRANSITIONS. 5.2 says a matching production must not be retained and must wake no
reader; it says nothing about the probes, and a probe reader is not a reader under the Terms table.
Returning early from the whole method is what makes `s.set(fetchSameThing())` leave `PENDING` set
forever, against **7.11** — an accepted production, which this is, MUST clear the stale mark. So the
early return skips retention, the version bump and `persist`, and nothing else.

7.9 and 3.14 are the clauses that SET the bit, not clauses a stuck bit offends: 7.9 mandates
`s.pending` over a stale value, and 3.14's antecedent ("a landed value that is not stale") never
holds in the duplicate case, where `serving` is true and the bit is `REFRESHING`. An earlier
revision listed both as violated, which is a citation resolving while what it means moved. 2.12 is
vacuous rather than violated — a never-falling `PENDING` never satisfies its antecedent — and the
real harm, an `await` that never settles, is owed a clause of its own.

`CLEARED_BY_A_PRODUCTION` has to contain `REFRESHING` and `STREAMING`: `load` sets `REFRESHING`,
and **3.15** — *"`s.streaming` MUST be true while a stream a producer is on is open, and MUST be
false once it closes"* — is the general clause for the other. An earlier revision cited 8.7 here,
which is the `Store`-RESTORE corner case scheduled six phases later; a reader following it lands on
restore semantics and never learns that the ordinary close path is what requires the bit to clear.
7.5 is likewise scoped to `s.refresh`, and the `load` this argument is about is reached from
`s.set` — **no live clause requires `s.refreshing` to go false on the write path.** The structural
argument ("neither is cleared anywhere else, so leaving either out latches the probe for the life of
the node") is sound and the numbers do not carry it. Owed a clause.

Its omission of `DONE` is correct, and the clause is **3.8** — `s.done` stays true through
`s.refresh`. That was uncited and unscheduled; it is in phase 1 now.

`headReplaces`, `settles` and `gated` ARE THE ROOM'S THREE REAL ARMS, and they are the place the
"inert field" framing does not reach. 5.8 has `s.set` replace the head production on a room and mint
no sequence number, 3.9 has `s.done` remain false while a room is live, and 5.5 gives a room
reference identity precisely so structurally-equal messages are not swallowed — but **`===` on a
primitive IS value equality**, so a room whose messages are strings or numbers drops its second
`'ping'` under 5.2 with no retention, no sequence number and no wake. A heartbeat stops. `gated` is
the duplicate gate's own switch, off on a room. CLAUDE.md's uniformity bias is about an option that
does nothing on one producer, not about a shared path that produces a wrong answer there; all three
are decided at construction and read, never branched on per write.

`serving` is 3.14 written once: refreshing over a landed value, pending where nothing has landed or
7.9's stale mark is set. It is scoped to `s.set`, and a re-adoption reaches it by 11.16 and 11.19
instead (D84).

### `ReactiveNode`'s fields

Twenty, every one written by the one constructor, `undefined` included. The list is here because
CLAUDE.md fixes an object's shape at construction and this is the object every production writes;
`SERVER.md` enumerates `Call`'s nine and `Scope`'s ten for the same reason, and an earlier revision
of this plan enumerated `Link`'s eight and left this one to be reconstructed from usage.

| Field | Carries | Phase |
| --- | --- | --- |
| `value` | the current `Stored` | 1 |
| `version` | the VALUE channel's token, bumped by an accepted production | 1 |
| `pulse` | the STATUS channels' token, bumped by any transition | 1 |
| `status` | the bitfield | 1 |
| `error` | what `s.error` reports — 4.10, and the premise RULEBOOK does not carry | 1 |
| `errors` | the error channel's token; why a second rejection wakes | 1 |
| `epoch` | supersedes a load in flight; bumped by every write | 1 |
| `subscribers` | the doubly linked edge list | 1 |
| `reader` | the owned `Reader` on a memo; `undefined` elsewhere (11.25) | 3 |
| `walk` | `propagated`'s diamond mark | 3 |
| `schema` | 4.3's gate | 1 |
| `transform` | 4.7's shaping | 1 |
| `identity` | the normalised two-argument comparator (5.3) | 1 |
| `gated` | whether the duplicate gate runs — off on a room (5.5) | 1 |
| `headReplaces` | 5.8 | 1 |
| `settles` | what a production sets beside `SUCCESS` (3.9) | 1 |
| `ring` | retention | 2 |
| `sequence` | the number `publish` mints (9.7); NOT the `ttl` clock | 2 |
| `store` | 8.x's backing; `persist` reads it | 9 |
| `adopted` | what 11.15's members delegate to; `undefined` where nothing is adopted | 7 |

`sequence` and the `ttl` time source were one field called `clock`, named once and never defined.
5.8 forbids minting a sequence number on a room and 9.7 has `publish` hand one back — two clauses
about one of them and none about the other. They are separated here and the time source lives on
`Ring`.

Fields whose phase is later than 1 are still written by the phase-1 constructor, as `undefined`.
That is the point of enumerating them now: a field added on a later path is the shape mutation the
hot-path rule forbids, and this table is what makes "added later" visible as a diff.

## The schema call

`schema.parse(incoming)` matches **no arm of the type**. REGISTRY types `Schema<T>` as
`((value: unknown) => T) | StandardSchemaV1<T> | JsonSchema`: a plain function has no `.parse`,
`JsonSchema` is a `JsonValue` and has no `.parse`, and StandardSchemaV1 validates through
`~standard.validate`. An earlier revision filed this under "Still undecided" as one of "three call
shapes across three plans" — but `COMPILER.md`'s is about how a `Schema` is DERIVED and
`SERVER.md`'s is the `JsonSchema` arm of the same union, with 19.8 putting coercion in the pipeline
rather than in the call. There is one call shape and this plan had it wrong; it is a defect, not an
open question.

`validate.ts` holds the three arms. 19.5 has the plain-function form THROW what it refuses, which is
the arm the `try`/`catch` was written for; the other two answer rather than throw.

## The face

```ts
const FACE = Object.assign(Object.create(Function.prototype), {
    set, patch, peek, tail, then, catch: caught, finally: finished,
    [Symbol.asyncIterator]: iterate,
    pending, refreshing, done, success, streaming, error, isError,
    invalidate, refresh, watch,
    publish,                        // 11.15 — see below
})

export function face(node: ReactiveNode) {
    const read = () => read.node.read()
    Object.setPrototypeOf(read, FACE)   // prototype BEFORE the own property, or the shape mutates
    read.node = node
    return read
}
```

Twenty members, which is what the elided list always was. `read.node` rather than a captured
`node` because the arrow would otherwise keep a context cell alive holding the same reference the
own property already holds — the node stored twice for the object's whole lifetime, in a design
whose primary currency is allocations per template node.

The honest cost is **two allocations and two map transitions**, not "one closure and two property
writes": the arrow is one, `setPrototypeOf` is a runtime call and a transition rather than a
write, and the own-property add is the second transition. The ordering rationale is that the
transition is cached on the pre-`node` map and shared across every face; *both* orders cost two
transitions, so "an object that already has a shape" does not distinguish them and was the wrong
reason for the right order.

A closure rather than a class instance because a `Reactive` must be CALLABLE — REGISTRY's `s` row is
`() => Stored`, and `read()` is the read. (1.1 is *"Every producer in this design MUST hand back a
`Reactive`"* and says nothing about how one is read; RULEBOOK's format rule forbids it from
carrying a signature at all. An earlier revision cited 1.1 here, correctly at its first use and for
a different claim at its second.) `setPrototypeOf` on a function object preserves `[[Call]]` — an
internal slot, never inherited — so `typeof`, `instanceof Function`, `.bind` and `.call` all hold.

**11.15 does not need a `Proxy`, and it is what settled the shape.** *"Adoption MUST forward members
the adopted `Reactive` declares beyond the common face, by delegation to whatever is currently
adopted"* reads as an open-ended member set, and against one, a shared prototype loses and the two
escapes are a per-node prototype or a `Proxy`. The set is not open-ended: REGISTRY types `Room` as
`Reactive<Message, Accepted, Failures> & { publish }`, the keyed memo's pattern forms are common-face
names with a widened signature, and **only `state`, `memo` and `channel` mint a `Reactive`** — there
is no app-authored subtype anywhere in REGISTRY. The set beyond the common face is one name.

So what is dynamic is the DELEGATION TARGET, not the member set, and a target is a field read:
`publish` sits on the shared `FACE` and delegates through `node.adopted`, refusing where nothing is
adopted. 11.16 — "clear where the newly adopted `Reactive` has nothing to serve" — then falls out
rather than being implemented, because re-adoption writes one field and "nothing to serve" is
`adopted === undefined`. `publish` is inert on a producer that is not a room, which is the uniformity
bias where it actually fits.

A `Proxy` would have put an `apply` trap on `s()` — the per-row read from a template slot, the
hottest call in the design — to serve one name on one producer kind that first appears in phase 7.
Per-node prototypes give every adopting face a distinct map and make `s.pending()` megamorphic.
The refusal rests on the CLOSED MEMBER SET, which is durable; the earlier revision refused a `Proxy`
on cost, unmeasured, which is not a reason this repo accepts in either direction.

**The one thing that would flip it:** 31.8's second half — *"and the value's method otherwise"* — IS
open-ended. `s.toUpperCase()` is resolvable only from the value's type, and if that ever became a
runtime question a `Proxy` is the only mechanism that works. It is not one today: 31.8 is one of
`COMPILER.md`'s five type-directed sites, decided at compile time inside a `.abide` file, and outside
one an author writes `s().toUpperCase()`. **The face design rests on the compiler keeping that
promise and nothing currently records the dependency** — it is in "What the docs owe".

Members read `this.node`, so an extracted `const p = s.pending` loses its receiver — the compiler
always emits the call form and `watch(s, …)` passes the face itself, but that wants a lint rather
than being left implicit. `s.node` is reachable from application source and is not a name an app
author should write; it owes a REGISTRY row saying so, and the lint owes a clause. Note
`COMPILER.md` has a *typing* fix for the same hazard from the other end — its projection defect 1,
where a bare `{invoice.pending}` types as the API member against 31.7 — and neither plan cites the
other. Which fix wins is open.

## Build order

Each phase is gated by the one before it, and the ordering is not arbitrary: the ring is what a
window buffers into (D68), so windows cannot land before retention; adoption is delegation to a
`Reactive` (D43), so it cannot land before there is one; and group 15 is called by phase 1's own
`produce`, so it cannot land after it.

| Phase | Lands | Clauses |
| --- | --- | --- |
| 0a | the vanilla arm, the counter record, `ReactiveNode`'s field list | 44.24, 44.25 |
| 0b | refusals — `Failed`, `validationError`, `refuse.typed`, `isFailed` | 15.1, 15.2, 15.4–15.7, 15.9, 15.10, 15.12–15.16 |
| 1 | graph, node, `state`, `watch` | 1.1, 1.3–1.7, 2.1–2.6, 2.12, 2.13, 3.1–3.3, 3.5, 3.8, 3.10, 3.11, 3.13, 3.14, 4.1–4.13, 5.1–5.10, 12.1, 12.2, 12.4, 12.7–12.10, 14.1–14.11, 14.13 |
| 2 | `Ring` — `tail`, `ttl`, cursors | 2.8, 2.9, 2.11, 6.1–6.10 |
| 3 | unkeyed `memo`, propagated probes, triggers, writes to a memo | 7.1–7.5, 7.7–7.12, 7.14, 11.1, 11.5, 11.7–11.11, 11.20–11.22, 11.25, 11.59, 11.61 |
| 4 | **scopes** — `state.share`, the memo's default scope, `global` | 10.1, 10.3–10.7, 11.34–11.42, 12.5 |
| 5 | **the server reader** — 14.12's sink-registering `Reader`, the run-once `watch`, the per-read push | 3.4, 12.6, 14.12, 35.7 |
| 6 | keyed `memo` — `Args` canonicalisation, entries | 11.2–11.4, 11.6, 11.26–11.33, 11.43–11.47, 11.52–11.56, 11.62, 11.63 |
| 7 | adoption | 11.12–11.19, 11.57, 11.58, 11.60 |
| 8 | `channel`, rooms, streaming | 3.6, 3.7, 3.9, 3.15, 7.13, 9.1, 9.3–9.5, 9.7–9.21 |
| 9 | stores | 8.1–8.15 |
| 10 | `throttle` and `debounce` | 5.11–5.19 |
| 11 | selections | 13.1–13.10 |

Every live clause in groups 1–15 appears exactly once, except **14.16**, which appears nowhere on
purpose — see below. 3.4 is phase 5's and not phase 1's, because who opens a sink is open. The five
handed away: **10.2** and **15.11**
to `COMPILER.md`'s closed list of static refusals, **14.14** and **14.15** likewise, and **15.8**
(`notFound`) to `SERVER.md`. **11.36** and **11.40** are shared with `SERVER.md`'s stage 1 — a
dependency rather than a handover, and why phase 4 is where it is.

**14.16 is owned by nobody.** An earlier revision claimed it under a `14.x` wildcard; it reads "The
compiler MUST warn…", and `COMPILER.md` declares its static-refusal list closed at fifteen without
it. It is in "Still undecided" rather than silently inside a range here.

**Phase 4 moved in front of everything on the server side.** `SERVER.md`'s stage 1 holds the
request-local memo entry map as a `Scope` field (11.34) and its own gate calls the 11.34 revert
"cross-request data disclosure — the most severe correctness bug in this document". An earlier
revision of this plan scheduled 11.34 nowhere and listed the scope question as wholly open, while
`SERVER.md` had already closed a third of it and built on the answer. Both plans pointed at each
other for 10.5; `RENDERER.md` meanwhile runs `state('')` in a component body with no stack of any
kind and has no open-questions section to notice. The stack is phase 4's and the two consumers are
named here.

**Phase 5 is the phase an earlier revision did not have.** It said server behaviour "cuts across all
of it … and lands with SSR rather than as a branch inside a read", naming no phase — and
`RENDERER.md` had already answered that: *"`REACTIVE.md` owns 14.12's reader and owes it a PHASE, not
a deferral to a stage in another document."* It is also not true that "nothing in `subscribe` learns
which side it is on": 14.12 requires a tracked read on a server to **register no subscriber**, and
`subscribe` unconditionally attaches one. Either it branches or the `Reader` carries the kind field
it now has. `RENDERER.md` 2, `COMPILER.md` 3 and `SERVER.md` 6 are all blocked on this phase.

**Who opens a sink is undecided and 3.4 is in phase 5 provisionally.** 3.4 says *"A sink MUST be
opened by `s.pending`"*; `RENDERER.md`'s compiled generator opens it at the call site with
`if (rows.pending()) { yield sink(context, 0) }`. Two mechanisms for one clause, and
`RENDERER.md` is the document that notes `sink` has four plans touching it and no owner.

## The vanilla arm, and what a ratio here is worth

CLAUDE.md records that two rewrites of the reactive core landed as no-ops because the path they
improved is 0.055 of a 1.45 ms op, and that the same graph reads 1.67x a hand-written signal under
JSC and 0.21x under V8 — inverted, not scaled. So:

* **Phase 0a writes the arm.** `let value; const subscribers = []`, hand-written, in
  `harness/measure`, which has no abide in its graph. This is LANDED —
  `packages/harness/src/measure/vanilla/signal.ts`, whose header cites this phase.
* **Phase 0a also lands the counters**, which are not optional and are not this plan's to invent
  freely: 44.25 is a LIVE clause making `__ABIDE_WORK__` a fixed-shape record and 44.24 makes a
  missing field a throw. `PUBLISHED_WORK_FIELDS` is `['wakes', 'bindingRuns', 'descents']` today and
  this plan needs at least `links`, `subscriptions` and `entries` beside them — an amendment to a
  landed leaf, plus rows on `Work`. The dev flag that installs the record is **abide's to name** and
  `HARNESS.md` is waiting on it. Until this lands, four of the gates below assert nothing:
  `measure/case.ts` records that a record missing `descents` reports 0 and the k=8 gate passes on it.
* **The share is phase 0b and phase 0b comes AFTER a page serves.** An earlier revision put it in
  phase 0 and owed "the reactive layer's fraction of the 500-row patch-transform reorder's
  click-to-paint". Every piece of that is downstream: `shares()` is `harness/engine` over CDP and
  needs a served page, `abide build` throws `compiler not implemented`, and the op does not exist —
  `patch-transform`'s manifest op is "apply one frame from the feed" over a four-region `FEED` with
  a whole-list `replaceChildren` and no bench block. A phase 0 demanding it is a phase 0 that
  depends on `SERVER.md` stage 6, which depends on this plan's phase 5, and nothing ever starts.
  `SERVER.md` caught this exact shape in its own stage 0 and moved the measurement; this is the same
  fix. **Phase 0b is taken with `RENDERER.md` measurement 1 and `SERVER.md` measurement 2, on the
  first served page, and the 500-row reorder is written as a bench arm before it is quoted as one.**
* **The threshold is 4%, not 10%, and it is read off `ceilingObserved`.** 10% would not have fired
  on either of the two rewrites the threshold exists to prevent — 0.055 of 1.45 ms is 3.8%, and
  CLAUDE.md records the ceiling as 4%. A threshold no observed value has ever crossed has never been
  shown to fire. `shares()` returns two ceilings and `ceilingCpu` is a CPU fraction, which CLAUDE.md
  forbids quoting as latency; `ceilingObserved` is hard-zero under one frame, so the op has to be
  sized past a frame for the number to exist at all, which is the same reason n = 500.
* **This design is held to allocation count and clause coverage, not to ms** — with the caveat that
  a prediction is not a result. Below the threshold, allocations and clause coverage are the budget.
* Both substrates or neither, once there is an abide arm to run. `playwright.harness.config.ts` runs
  `packages/harness/e2e/` under chromium and webkit with no `webServer` and is usable today;
  `playwright.config.ts` cannot run at all, because its whole-run `webServer` is `abide start`, which
  throws. Until an abide arm exists, "both substrates" can only deliver vanilla against vanilla,
  which `ratio()` refuses outright.

## Work gates

Each is a "does less work" contract, so a correctness test cannot guard it: the wrong
implementation still produces the right output.

**None of these can be a `gate()` call, and that is a finding rather than an omission.**
`gate(name, { revert, worth }, body)` takes a function that INSTALLS the broken arm, and its own
`GateSpec` comment says a revert that cannot be installed "keeps its revert in the test's comment
with the number it reports". Every mechanism below is a module-level function or a field fixed at
construction; swapping one behind a flag with a single live value is the machinery this repo
deletes. So the column is **the revert to hand-apply**, `bun run test:gates` verifies none of them,
and this file's own discipline is what carries it — which is exactly the case CLAUDE.md carves out.

`worth` would not have carried them either: it is checked by `reported.includes(String(value))`, so
a worth of `0` or `1` matches almost any failure message. Where a row's number is `1`, the number is
doing nothing and the revert is the whole gate.

| Asserts | Revert to hand-apply | What it reports with the mechanism out | Lane |
| --- | --- | --- | --- |
| a reader of `s.pending()` alone does not wake on a value change | one subscriber list instead of the mask | 0 → 1 wake | `wakes`, `bun test` |
| a reader whose read set SHRINKS between runs stops waking on what it dropped | `link.mask \|= mask` in `claim` — widen across runs | 0 → 1 wake per subsequent write | `wakes`, `bun test` |
| a reader reading `a(), b(), a()` still wakes on `b` | sweep from `cursor` rather than `highWater` | 1 → 0 wakes, and `b` silently unsubscribed | `wakes`, `bun test` |
| a reader touching one node twice in a run holds the UNION of both masks | drop `attach`'s second arm | 2 → 1 channel; the probe or the value read stops waking | `wakes`, `bun test` |
| a probe-only reader woken by a settled load re-runs its body ONCE | resolve `CHECK` against `version` alone — drop `pulse` | 1 → 0 body runs, and the spinner never hides | `bindingRuns`, `bun test` |
| a second consecutive rejection wakes a reader of `s.error` | drop the forced `\| ERRORED` from `fail` | 1 → 0 wakes, stale error on screen | `wakes`, `bun test` |
| a load whose settle is REFUSED clears `PENDING` | apply `CLEARED_BY_A_PRODUCTION` in `produce` only | false → true forever on `s.pending()` | `bun test`, correctness |
| `s.patch` wakes its readers | route `patch` through `produce`'s duplicate gate | n → 0 wakes on a 500-row reverse | `wakes`, `bun test` |
| a settled load does not overwrite a newer synchronous write | bump `epoch` in `load` only | the value reverts 800 ms later | `bun test`, correctness |
| a memo recompute yielding an equal identity wakes zero effects | push eagerly rather than the CHECK walk | 0 → every downstream effect | `wakes`, `bun test` |
| an unkeyed memo holds zero probe subscriptions while `pending()` still goes true | a subscription per source for probes (11.22) | 0 → 1 per source | `subscriptions` (**new field**) |
| a probe over a k-deep 2-wide layer chain descends 2k nodes, not 2^(k+1)−2 | drop `source.walk` from `propagated` | k=8: 16 → 510 | `descents`, `bun test` |
| `ttl` expiry on a ring wakes no reader (6.4) | wake on eviction as well as on production | 0 → 1 wake per expiry | `wakes`, `bun test` |
| per-write ns at `tail: 4096` is within the measured A/A floor of `tail: 4` | rebuild retention per write rather than append (6.2) | 1.0x → ~1000x | **`bun run bench`** |
| probing an uncomputed key leaves the entry map the same size | get-or-create on the probe path (11.62) | 0 → 1 entry | `entries` (**new field**) |
| a read with a stable dependency allocates nothing | allocate a `Link` per read rather than reusing | 0 → 1 `Link` per read | `retained()`, fresh process |

Five rows changed meaning rather than wording, and two of them previously asserted the bug:

* *"a probe-only reader re-runs its body zero times"* was the `CHECK`/`version` defect written down
  as a contract. A reader of `s.pending()` alone MUST re-run when the load settles, because
  `pending()` flipped.
* *"a second consecutive rejection still wakes"* named a revert — "leave `ERRORED` latched across
  `load`" — that the code already did, so the gate failed against its own design.
* The diamond row's `256` was the LEAF count on one of two readings of "k stacked diamonds", and the
  prose meant a 2-wide layer chain. Total visits with the mark dropped are 2^(k+1)−2 = 510 at k=8,
  and `Work.descents` counts nodes visited. Under the literal stacked-diamond reading it is 3k = 24.
  The graph shape is named in the row now because the number is meaningless without it.
* The `tail` row asserted 1.05x against a floor it had not measured. `ratio()` returns
  `underTheFloor` when the value is inside the measured A/A spread for that case on that machine, so
  a hard-coded 5% is either redundant or unreachable. Assert against the floor.
* It also cannot run in the gate: `batch()` throws in a parallel worker and `bun run test` is
  `--parallel`. And it cannot go through `measure`'s `time()` either, which sets `emulated: 'dom'`
  whenever `document` is defined — `bunfig.toml` preloads happy-dom into every `bun test` process,
  so a ring write that touches no DOM throws anyway. `harness/report`'s `batch()` directly, under
  `bun run bench`.

Three rows do not distinguish a wrong implementation on the count alone and need a positive
assertion in the same body: "holds zero probe subscriptions" passes against a memo that derives
nothing, "entry map the same size" against one that creates and evicts in the same tick, and
"allocates nothing" against a read that subscribes to nothing. This is CLAUDE.md's rule that a guard
derived from a summary needs a case satisfying the guard and violating what it stands for.

**Not gated, and owed one:** an identity-stability counter. CLAUDE.md's first reactive invariant is
that a freshly built wrapper defeats an identity check, `produce`'s duplicate test is exactly where a
re-wrapped envelope would silently defeat it, and nothing here counts distinct identities per n
writes. `HARNESS.md` says it is three lines and lists it as in no plan's gate table.

Also ungated in groups 1–15, from `HARNESS.md`'s candidate set: **9.4** (no accumulation by copying
per chunk — CLAUDE.md's O(n²) `concat` invariant verbatim, and the subject of an open question
below), **11.10**, **11.18**, **11.5**, **11.6**, and the later-phase 7.3, 8.8–8.10, 9.16, 12.6.

## Budget

Filled in at landing, from the arm rather than from a profiler's summary.

| | Target |
| --- | --- |
| allocations, read with a stable dependency | 0 |
| allocations, read that adds an edge | 1 `Link` |
| allocations, production | 0 — a ring SLOT is not an allocation where the ring is pre-allocated, and 6.2 requires it to be |
| allocations, async write | 4 — two handler closures, the derived promise, the epoch capture — plus one microtask tick |
| microtask ticks, settled write | 0 |
| structural compare, `set` of an n-element value | the 5.4 default's deep walk, stated at n = 500 beside the graph walk |
| subscriber walk, wake | readers whose mask intersects, and no others |
| LOC over the vanilla arm | measured at phase 1, stated out loud |
| exported names added | **29** across thirteen files |
| branches added to a shared path | counted on `produce` / `patch` / `set` / `wake`, the four every WRITE walks |

**29, not 15.** The flags leaf alone is 16 (`PENDING` … `DIRTY`, `PROPAGATED`, `IN_FLIGHT`,
`CLEARED_BY_A_PRODUCTION`, `CLEARED_BY_A_SETTLE`); `graph.ts` is 8; `guards.ts` 3; and the remaining
ten files one or two each. The earlier figure counted neither the leaf nor the six names the sketch
already called (`untracked`, `isReactive`, `isThenable`, `isFailed`, `validationError`, `structural`)
and which had no file at all. Since this plan takes ms off the table, the triple IS the budget, and
the one number of the three that is computable before any code was written was off by nearly 2x.

There is no producer for this row: `harness/scripts/countExportedNames.ts` imports package entry
specifiers and counts runtime keys, so it would report `abide`'s public surface (roughly four names),
not internal per-file exports. Hand-counted, and `HARNESS.md` says so.

`subscribe` is off the branch list because it is walked on a READ; `wake` is on it because it is the
only one of the four whose cost scales with the subscriber count. `produce` as sketched carries
**twelve** branches — `schema`, its refusal arm, `transform`, its refusal arm, `gated`, `SUCCESS`,
the `&&` into `identity`, `!duplicate`, `headReplaces`, the `duplicate ?`, `woke !== 0`, and the
trailing `!duplicate` before `persist` — against the vanilla arm's **one**. An earlier revision
enumerated five and named `serving`, which is on a different path entirely; the first draft of THIS
revision said nine, having skipped the two guards it had just added. Both figures were a `grep`
away, which is the whole of why the row is here. Twelve against one is the ratio it exists to
police, and it has already tripped in the document that states it; the uniformity bias is being
paid for somewhere and this is where to look first.

## What the docs owe

Nothing below is decided; each is a thing this plan would have to land somewhere gated before the
code does. Numbers are NOT pre-allocated here — group 42 is `The app object`, 43 is spoken for by
`COMPILER.md` and 44 is the measurement harness, so the next free group is 45 and a plan is not the
place to spend it.

**RULEBOOK.**

* **A duplicate still transitions.** A write of an equal value still moves `PENDING`/`DONE` even
  where 5.2 stops the value propagation. Refuses the reading where `identity` gates the whole
  transition rather than the value channel alone.
* **A patch is never a duplicate.** `s.patch` mutates in place, so the gate has no previous value to
  compare and must not run. Refuses routing `patch` through `produce`'s duplicate test.
* **A failed producer fills `s.error`.** The premise the two-bit split rests on, which 4.10 carries
  only for a REFUSED WRITE. Without it, "one bit cannot answer both" is argued from outside the
  document.
* **A settle of any kind ends the in-flight bits.** 7.11 covers an accepted production; nothing
  covers a refusal or a rejection, and a load refused by its schema latched `PENDING` for the life of
  the node.
* **`s.refreshing` MUST go false on the write path.** 7.5 is scoped to `s.refresh`; the `load` that
  sets the bit is reached from `s.set`.
* **A second production on the same channel wakes a reader of that channel.** The error case
  generalised: the mask reports transitions and has no channel for "same bit, new payload".
* **`ERRORED` and `PRODUCER_FAILED` are two channels, not one.** 2.3 makes a read throw where a
  producer failed and nothing has landed; 2.4 and 2.5 do not. Refuses one bit.
* **A wake is filtered per edge and delivered at `DIRTY`.** A reader is woken only where its own
  mask intersects the transition, and an edge that woke on a channel it subscribed to is dirty, not
  a candidate. Refuses taking the level from the masked XOR.
* **Validation reads two tokens.** The value channel revalidates against `version`, the status
  channels against `pulse`. Refuses one counter for both.
* **Every write supersedes a load in flight.** Refuses an epoch bumped only by another load.
* **A lint for an extracted member.** `const p = s.pending` loses its receiver. Owes a clause and a
  surface on `abide check`, and has to be read against `COMPILER.md`'s projection fix for the same
  hazard.
* **14.16 needs an owner.** It reads "The compiler MUST warn…" and is in neither plan's list.

**REGISTRY.**

* `s.node` — reachable from application source, not a name an app author writes. It owes a row
  saying so, or the face owes a spelling that is not reachable at all.
* `structural` is a REGISTRY name with no file until `comparator.ts` exports it.

**DECISIONS.** Each RULEBOOK proposal above names an alternative it refused, so each owes an entry.
Three more that refuse something this plan did not previously record:

* **`Proxy` and the per-node prototype, refused for the CLOSED member set** — not for cost, which
  was never measured. Assumes: only the framework mints a `Reactive`, and 31.8's value-method half
  stays a compile-time question. **If either premise moves, the face design moves with it** — this
  is the D3 shape and the entry has to say so.
* **One `Reader` class with a `kind` field, refused three implementations**, for the megamorphic
  dispatch in `wake`'s loop.
* **`revalidate` over `refresh`**, refused for a name REGISTRY spends twice in this package.

## Still undecided

* **Which of the three accumulation variants a `channel` uses.** CLAUDE.md names them — version +
  lazy snapshot where writes dominate, a structural compare that KEEPS the old identity where reads
  dominate, a cursor where the reader consumes in order — and says the read/write ratio decides.
  9.4 forbids accumulation by copying per chunk and is ungated. Deciding it needs the ratio measured,
  and **`HARNESS.md` lists the producer for that ratio as itself undecided**, needing two more
  `PUBLISHED_WORK_FIELDS` entries and two more `Work` rows. This is blocked on a harness change, not
  on an argument.
* **The chunk write path.** Not `produce` — see the flags leaf — and not sketched anywhere. Phase 8
  owns it and 3.6, 3.15, 4.8 and 5.2 are what it is checked against.
* **Who opens a sink**, 3.4 against `RENDERER.md`'s call-site `yield sink(...)`. Two mechanisms, one
  clause, four plans touching it.
* **Where the component-instance scope stack lives.** Phase 4 schedules 10.5, 11.34 and 12.5 against
  it. `SERVER.md` answers one third and says the rest waits on `RENDERER.md`; `RENDERER.md` runs
  `state('')` in a component body with no stack and has no open-questions section. An earlier
  revision of this file claimed the item was "on this list and on no other" — it is on `SERVER.md`'s
  twice.
* **What a `Schema` is at the call site** is now a DEFECT rather than an open question — see "The
  schema call". What remains open is the widening: 19.13 and D22 govern today, 19.16 and P1 govern
  once `COMPILER.md` lands, and that plan withdraws the one and reverses the other.
* **Whether `Link` reuse across runs wants a free list.** A reorder allocates a duplicate edge and
  drops the stale one at end of run. It self-heals, and whether the garbage matters is a
  measurement rather than an argument. Note `propagated`'s short-circuit makes a probing reader's
  source list RUNTIME-STATE-DEPENDENT — which source is pending decides which get subscribed — so
  the "0 allocations on a stable dependency" budget row is about a reader that reads no probes.
* **`14.16`'s owner**, and **11.37, 11.38, 11.41, 11.42, 11.60, 11.63** — scheduled here now, but
  each is `global`-stream or late-joiner behaviour that `SERVER.md` may have a better claim on.
* **The counter dev flag's name.** `HARNESS.md` says it is abide's to name and is waiting.

## What this revision changed

Against the five-dimension review of 2026-09-11. Design defects, in the order they bite: the
`CHECK`/`version` hole that killed four of five probe transitions; `s.patch` silently waking nobody;
`refuse` and `fail` never clearing the in-flight bits; the epoch bumped only by a load; `ERRORED`
set→set waking nobody; `wake` reading a successor it had already handed to `notify`; the torn write
between the value commit and the status commit; `attach` and four other load-bearing functions named
and never written. Structural: one constructor rather than three; `ReactiveNode`'s twenty fields
enumerated; one `Reader` class with a kind; `propagated` iterative and cycle-safe; the face's
`publish` delegating rather than a `Proxy`. Scheduling: phases 0a, 0b, 4 and 5 are new, every live
clause in 1–15 is scheduled exactly once, and the seven handed away are named. Measurement: the
share moved behind a served page, the threshold is 4% off `ceilingObserved`, the gates are marked
hand-applied with their lanes, two that asserted the bug are corrected, and the exported-name budget
is 29. Citations: 1.1, 8.7, 7.5, 3.14, 2.12 and the `s.error` premise.
