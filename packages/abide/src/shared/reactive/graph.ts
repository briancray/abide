// TRACKING, EDGES, THE DIRTY WALK AND THE EFFECT QUEUE. Everything a read and a write
// walk, and the only module in this seam whose cost scales with the subscriber count.
//
// `flushEffects` rather than `flush` because `SERVER.md` already names a `flush.ts`
// for the generator → `ReadableStream` pump, and two mechanisms under one name in two
// seams is a debugging trap neither plan owns. `revalidate` rather than `refresh` by
// the same argument inside this seam: REGISTRY spends `refresh` twice already — the
// `Selection` form and `s.refresh` — and both land in this package.

import { WORK } from './counters.ts'
import {
    CHECK,
    CLEAN,
    DIRTY,
    ERRORED,
    PROPAGATED,
    VALUE,
} from './REACTIVE_FLAGS.ts'
import type { ReactiveNode } from './ReactiveNode.ts'

// THREE THINGS READ REACTIVELY and they are one class with a `kind`: 12.2's effect,
// 11.1's unkeyed memo body, and 14.12's server sink. `kind` rather than three
// implementations of `notify` — the call from `wake`'s loop is the hottest call site
// in the design, and three classes behind it is a megamorphic dispatch in the loop
// every write walks.
//
// TWO VALUES, not three. 14.12's server sink is a third and it is phase 5's to add —
// a constant nothing passes is the machinery this repo deletes, and the `kind` field
// it will use is already here.
export const EFFECT = 0
export const MEMO_READER = 1

export class Link {
    node: ReactiveNode
    reader: Reader
    mask: number
    // `node.version` at the last claim — the VALUE channel's token.
    seen: number
    // `node.pulse` at the last claim — the STATUS channels' token. One token cannot
    // serve both: `pulse` moves on every transition that changed a bit and `version`
    // only on an accepted value production, which is 5.1 and 5.2's distinction made
    // checkable. Resolving a status transition against `version` is what left
    // `s.set(fetchUser())` notifying `CHECK`, finding the version unmoved, and
    // dropping the reader back to clean with the spinner never shown.
    seenPulse: number
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
        // Every field at construction, `undefined` included — one shape, and this is
        // the object a reorder allocates.
        this.prevSubscriber = undefined
    }
}

export class Reader {
    kind: number
    // Bumped per evaluation. An edge whose `claimed` is not this run was not read
    // this run and is swept.
    run: number
    dirty: number
    sources: Link | undefined
    sourcesTail: Link | undefined
    // How far this run has got along `sources`. Reset to `undefined` by the sweep.
    cursor: Link | undefined
    // The effect queue link — no array, and so no per-flush allocation. A reader is
    // enqueued exactly on its CLEAN → dirty transition, so `dirty !== CLEAN` is
    // already the "is it queued" flag and no second field is needed.
    queued: Reader | undefined
    // 14.12's sink, `undefined` off a server. 10.5 / 11.34 / 12.5's owner, phase 4.
    // Both are the inert-field shape rather than a reason to withhold them: a
    // `Reader` gains neither on a later path, and the shape is fixed here.
    sink: unknown
    scope: unknown
    stopped: boolean
    // What this reader evaluates. A memo reader owns a node and recomputes it; an
    // effect reader owns a body and a `Disposer`. One class, one `evaluate` with one
    // branch on a path walked per recompute — not per read, and not per wake.
    node: ReactiveNode | undefined
    body: (() => unknown) | undefined
    disposer: (() => void) | undefined

    constructor(
        kind: number,
        node: ReactiveNode | undefined,
        body: (() => unknown) | undefined,
    ) {
        this.kind = kind
        this.run = 0
        this.dirty = DIRTY
        this.sources = undefined
        this.sourcesTail = undefined
        this.cursor = undefined
        this.queued = undefined
        this.sink = undefined
        this.scope = undefined
        this.stopped = false
        this.node = node
        this.body = body
        this.disposer = undefined
    }

    // An edge that woke on a channel it explicitly subscribed to is DIRTY by
    // definition; CHECK is what a memo pushes onward, and it is resolved by
    // `revalidate` rather than by re-running anything.
    notify(level: number): void {
        if (this.stopped || this.dirty >= level) return
        const wasClean = this.dirty === CLEAN
        this.dirty = level
        if (!wasClean) return
        const node = this.node
        if (this.kind === MEMO_READER && node !== undefined) {
            // The memo does not yet know WHICH of its channels moved — it has not
            // recomputed — so the push covers every channel that can propagate and
            // `revalidate` narrows it per edge against the two tokens.
            notifySubscribers(node, PROPAGATED | VALUE | ERRORED, CHECK)
            return
        }
        enqueue(this)
    }

    evaluate(): void {
        if (this.stopped) return
        const node = this.node
        if (this.kind === MEMO_READER && node !== undefined) {
            this.dirty = CLEAN
            node.recompute()
            return
        }
        this.dirty = CLEAN
        runEffect(this)
    }
}

let ACTIVE: Reader | undefined

// 14.10 and 14.9 — a `Transformer`, a `Disposer`, middleware, a lifecycle hook and an
// event handler are not the flow. It is also what keeps an author's `identity` from
// planting an edge on whatever reader happened to be live when a write ran.
//
// THE REST ARRAY AND THE SPREAD CALL ARE FREE HERE, MEASURED, and the way that was
// established is worth more than the answer. `produce` reaches this three times per
// write — the schema gate, the transform, the duplicate gate — so a per-call array
// looked like the largest item on the write path, and an ablation said it was: two
// copies of this module interleaved in one process, the positional form against this
// one, reported 0.81x on five runs of five, and 1.32x with the arms swapped.
//
// IT WAS THE INSTRUMENT. With two copies in one process the call site is megamorphic
// and a spread call there is dear; with one copy — which is every real build — JSC
// monomorphises it and `bench:reactive` moves not at all (16.1 ns against 16.2 for a
// write with nothing subscribed, 68.3 against 66.7 for one that wakes a reader).
// Allocation says the same: `allocated()` reports `Structure 0.148` per write+wake
// either way, so escape analysis is already removing the array. The positional form
// was written, measured, and taken out again — three overloads and a looser
// implementation signature buy nothing.
//
// WHAT WOULD REOPEN IT is the substrate: this is JSC, escape analysis is what makes it
// free, and V8 is where a page runs. The same graph has measured 1.67x a hand-written
// signal under JSC and 0.21x under V8 — inverted — so this is worth one measurement in
// a browser once there is a page to take it in, and not before.
//
// REFUSED by the same instrument and the same caveat: a capacity-1 fast path in
// `Ring.push`, where the ring measured 5-7 ns of the op. The branch made `push`
// SLOWER on three runs of three, 1.06x to 1.57x — a small method with a second return
// stops being inlined.
export function untracked<Args extends unknown[], Result>(
    body: (...args: Args) => Result,
    ...args: Args
): Result {
    const previous = ACTIVE
    ACTIVE = undefined
    try {
        return body(...args)
    } finally {
        ACTIVE = previous
    }
}

// 14.13 — tracking is a strict push/pop around a SYNCHRONOUS segment, so a frame is
// never left on the stack across an `await` and a read in a continuation registers
// against nothing. On a server that is not free, and phase 5 owns it.
export function track(reader: Reader, body: () => unknown): unknown {
    const previous = ACTIVE
    const outerProvisional = provisional
    ACTIVE = reader
    provisional = false
    reader.run += 1
    reader.cursor = undefined
    try {
        return body()
    } finally {
        ACTIVE = previous
        sweep(reader)
        lastRunProvisional = provisional
        provisional = outerProvisional
    }
}

// 11.59 — a PROVISIONAL run, one that read a value which had not landed, mints no
// production. The flag is module-level rather than a `Reader` field for the same
// reason `ACTIVE` is: the mark is made by `read`, which holds the node and not the
// reader, and a field would have to be reached through `ACTIVE` anyway. It is saved
// and restored around every run, so a nested memo cannot leak its answer outward.
let provisional = false
let lastRunProvisional = false

export function markProvisional(): void {
    provisional = true
}

// Read immediately after the `track` whose run it describes.
export function wasProvisional(): boolean {
    return lastRunProvisional
}

// The mask is REPLACED on this run's first touch and ORed only within the run.
// Widening it ACROSS runs is a one-way ratchet: a reader that read `s()` once and only
// `s.pending()` afterwards would keep VALUE forever and wake on every value change it
// no longer reads — the right output, wasted work, and invisible to a correctness
// test.
function claim(reader: Reader, link: Link, mask: number): void {
    link.mask = link.claimed === reader.run ? link.mask | mask : mask
    link.seen = link.node.version
    link.seenPulse = link.node.pulse
    link.claimed = reader.run
    // 11.22's counter, and the mask test comes FIRST on purpose: it is false for every
    // ordinary value read, so the common path pays one predictable test rather than
    // two. Counting only the allocating arm of `attach` was not enough — a memo that
    // already holds a VALUE edge on a source widens it in place, so the broken arm
    // 11.22 refuses allocated nothing and the gate stayed green against it.
    if ((mask & ~VALUE) !== 0 && reader.kind === MEMO_READER)
        WORK.subscriptions += 1
}

// 3.3 — reading a probe subscribes to that probe alone. Naively that is seven
// subscriber lists per node; instead there is one list and each edge carries the mask
// of channels it wakes on.
export function subscribe(node: ReactiveNode, mask: number): void {
    const reader = ACTIVE
    // 14.7, 14.9, 14.10 — not the flow.
    if (reader === undefined) return
    const next =
        reader.cursor === undefined ? reader.sources : reader.cursor.nextSource
    // The same edge in the same position: the fast path, and the one a stable
    // dependency takes every run. No allocation, no scan.
    if (next !== undefined && next.node === node) {
        claim(reader, next, mask)
        reader.cursor = next
        return
    }
    attach(reader, node, mask)
}

function attach(reader: Reader, node: ReactiveNode, mask: number): void {
    // A REORDER: the edge exists somewhere ahead. Scanned from the cursor rather than
    // from `sources` — a backward scan would move the cursor behind an edge already
    // claimed this run, and a second read of that node would then allocate a
    // duplicate.
    for (
        let link =
            reader.cursor === undefined
                ? reader.sources
                : reader.cursor.nextSource;
        link !== undefined;
        link = link.nextSource
    ) {
        if (link.node !== node) continue
        claim(reader, link, mask)
        reader.cursor = link
        return
    }
    // A SECOND TOUCH of a node already claimed AT OR BEHIND the cursor. Widen in
    // place and do not move the cursor: the position is already right for the order
    // this run read.
    //
    // Dropping the arm is not a corner case, it is D69's own mechanism —
    // `propagated` subscribes the asking reader to a probed memo's sources, so
    // `{#if items.pending()}{rows()}` touches `rows` twice in one run, once with
    // PENDING through the walk and once with VALUE through the template.
    //
    // And the scan is INCLUSIVE of the cursor. Stopping one short of it — the obvious
    // spelling — misses the commonest case there is: two reads of the same node in a
    // row leave the cursor sitting on exactly the link to widen, so every
    // `s.pending()` beside an `s()` allocated a second edge on the same node and
    // carried it for that reader's whole life.
    const stop =
        reader.cursor === undefined ? undefined : reader.cursor.nextSource
    for (let link = reader.sources; link !== stop; link = link?.nextSource) {
        if (link === undefined) break
        if (link.node !== node || link.claimed !== reader.run) continue
        link.mask |= mask
        return
    }
    // Genuinely new: the only allocation on a read.
    const link = new Link(node, reader, mask)
    insert(reader, link)
    link.nextSubscriber = node.subscribers
    if (node.subscribers !== undefined) node.subscribers.prevSubscriber = link
    node.subscribers = link
    reader.cursor = link
    WORK.links += 1
    if ((mask & ~VALUE) !== 0 && reader.kind === MEMO_READER)
        WORK.subscriptions += 1
}

// AFTER THE CURSOR, so the source list stays in the order the run read it and next
// run's fast path hits on every edge. Appending at the tail instead would put a newly
// read node out of position and cost a scan per read for the life of the reader.
function insert(reader: Reader, link: Link): void {
    const at = reader.cursor
    if (at === undefined) {
        link.nextSource = reader.sources
        reader.sources = link
        if (reader.sourcesTail === undefined) reader.sourcesTail = link
        return
    }
    link.nextSource = at.nextSource
    at.nextSource = link
    if (reader.sourcesTail === at) reader.sourcesTail = link
}

function unsubscribe(link: Link): void {
    const node = link.node
    if (link.prevSubscriber !== undefined)
        link.prevSubscriber.nextSubscriber = link.nextSubscriber
    else node.subscribers = link.nextSubscriber
    if (link.nextSubscriber !== undefined)
        link.nextSubscriber.prevSubscriber = link.prevSubscriber
    link.nextSubscriber = undefined
    link.prevSubscriber = undefined
}

// THE SWEEP IS BY `claimed`, OVER THE WHOLE LIST, and there is no high-water mark.
// An earlier shape kept one and swept from it — but the pass has to visit the links
// BEHIND it too, since a reorder leaves unclaimed edges in the middle, so the mark
// bounded nothing and cost a field and two branches per read. Sweeping from the
// CURSOR is the defect it was invented against: a reader reading `a(), b(), a()`
// ends with its cursor at `a`, and `b` is dropped despite having been read.
function sweep(reader: Reader): void {
    let previous: Link | undefined
    let link = reader.sources
    while (link !== undefined) {
        const next = link.nextSource
        if (link.claimed === reader.run) {
            previous = link
            link = next
            continue
        }
        if (previous === undefined) reader.sources = next
        else previous.nextSource = next
        if (reader.sourcesTail === link) reader.sourcesTail = previous
        unsubscribe(link)
        link = next
    }
    reader.cursor = undefined
}

export function detach(reader: Reader): void {
    for (let link = reader.sources; link !== undefined; link = link.nextSource)
        unsubscribe(link)
    reader.sources = undefined
    reader.sourcesTail = undefined
    reader.cursor = undefined
}

function notifySubscribers(
    node: ReactiveNode,
    changed: number,
    level: number,
): void {
    for (let link = node.subscribers; link !== undefined; ) {
        // Read the successor BEFORE calling out: a server `Reader` (12.6) evaluates
        // synchronously from `notify`, re-subscribes, and its end-of-run sweep can
        // unlink the link we are standing on. The rest of the list would then never
        // be woken.
        const next = link.nextSubscriber
        if ((link.mask & changed) !== 0) link.reader.notify(level)
        link = next
    }
}

// Not called where `changed === 0`. A duplicate write and a redundant `load` flip no
// bit, and walking the whole subscriber list to `continue` on every entry is
// O(subscribers) for nothing on a per-frame path — the callers test first.
export function wake(node: ReactiveNode, changed: number): void {
    notifySubscribers(node, changed, DIRTY)
}

// Per edge and per mask, against BOTH tokens. Neither one alone answers: a status
// transition moves `pulse` and leaves `version` where it was, and an accepted value
// production moves `version` and may leave the status untouched.
function stale(link: Link): boolean {
    const node = link.node
    if ((link.mask & VALUE) !== 0 && link.seen !== node.version) return true
    if ((link.mask & ~VALUE) !== 0 && link.seenPulse !== node.pulse) return true
    return false
}

// Resolves a CHECK reader. Recursive on the MEMO CHAIN rather than on the source
// graph — the depth is how many memos an author stacked, not how many values a body
// read — and `propagated` is the walk that had to be made iterative, being reachable
// from a probe that 3.1 says must not throw.
export function revalidate(reader: Reader): boolean {
    if (reader.dirty === DIRTY) return true
    if (reader.dirty === CLEAN) return false
    for (
        let link = reader.sources;
        link !== undefined;
        link = link.nextSource
    ) {
        const owner = link.node.reader
        if (owner !== undefined && owner.dirty !== CLEAN) {
            if (revalidate(owner)) owner.evaluate()
            else owner.dirty = CLEAN
        }
        // A recompute above can wake this reader directly, which is the same answer
        // arriving by the other road — take either.
        if (stale(link) || reader.dirty === DIRTY) {
            reader.dirty = DIRTY
            return true
        }
    }
    reader.dirty = CLEAN
    return false
}

let queueHead: Reader | undefined
let queueTail: Reader | undefined
let flushing = false

function enqueue(reader: Reader): void {
    if (queueTail === undefined) queueHead = reader
    else queueTail.queued = reader
    queueTail = reader
}

// 12.12 — CHANGES WITHIN ONE MICROTASK WAKE AN EFFECT EXACTLY ONCE, so the writer
// schedules the drain instead of taking it. One tick of writes into one reader is one
// run of that reader, and the cost it removes is a DOM cost rather than a graph one:
// 200 metrics landing in one tick wrote the total tile 200 times, and a thousand
// tokens arriving together painted the transcript a thousand times. See D129.
//
// THE TICK IS A MICROTASK AND NOT A FRAME. A frame is the right grain for a paint and
// the wrong one for everything else — a server has no frames, an `await` on a value is
// not a paint, and a test would have to drive a clock. Coalescing per microtask is
// available in both substrates and is strictly fewer runs than per write; what a frame
// would add belongs to the renderer, which owns the paint. See D129.
//
// One flag, not a queue of callbacks: the microtask drains whatever is in the queue
// when it runs, so a second write in the same tick needs no second scheduling.
let scheduled = false

export function scheduleFlush(): void {
    // Inside a flush there is nothing to schedule: an effect that writes queues more
    // readers and the loop below takes them, in order, before it returns.
    if (scheduled || flushing) return
    scheduled = true
    queueMicrotask(() => {
        scheduled = false
        flushEffects()
    })
}

// THE SYNCHRONOUS DRAIN, and it stays exported for the two callers that cannot wait a
// tick: 12.6's server reader, where a render must finish inside the request rather
// than after it, and a test asserting what a write did. A pending microtask that finds
// the queue already empty does nothing, so calling this by hand is safe at any point.
// The guard is re-entrancy — an effect that writes queues more readers, and the outer
// loop takes them rather than a nested flush taking them in the wrong order.
export function flushEffects(): void {
    if (flushing) return
    flushing = true
    try {
        while (queueHead !== undefined) {
            const reader = queueHead
            queueHead = reader.queued
            if (queueHead === undefined) queueTail = undefined
            reader.queued = undefined
            if (reader.stopped) {
                reader.dirty = CLEAN
                continue
            }
            if (revalidate(reader)) reader.evaluate()
            else reader.dirty = CLEAN
        }
    } finally {
        flushing = false
    }
}

// 12.1 — the `Disposer` runs before each rerun, and once more at teardown. 12.7 has a
// throw from either reach `onError` with the trace attached and warn on `abide:watch`;
// 12.9 has an `Effect` that threw stop its `watch`. `onError` is group 37's and has
// not landed, so what is here is the warning, the stop, and 12.8's re-throw.
function runEffect(reader: Reader): void {
    const dispose = reader.disposer
    reader.disposer = undefined
    if (dispose !== undefined) {
        try {
            untracked(dispose)
        } catch (thrown) {
            reportEffectFailure(reader, thrown)
            return
        }
    }
    if (reader.stopped) return
    WORK.wakes += 1
    try {
        const result = track(reader, reader.body as () => unknown)
        reader.disposer =
            typeof result === 'function' ? (result as () => void) : undefined
    } catch (thrown) {
        reportEffectFailure(reader, thrown)
    }
}

let report: ((reader: Reader, thrown: unknown) => void) | undefined

// The one hook the effect path needs and the one thing this module may not import:
// `warn` is `#shared`'s and a `Disposer`'s failure is `watch.ts`'s to describe. Set
// once, at `watch.ts`'s module scope.
export function onEffectFailure(
    handler: (reader: Reader, thrown: unknown) => void,
): void {
    report = handler
}

function reportEffectFailure(reader: Reader, thrown: unknown): void {
    reader.stopped = true
    detach(reader)
    if (report !== undefined) report(reader, thrown)
}
