// ONE NODE TYPE, THREE FACES. 1.1 has every producer hand back a `Reactive`, so
// `state`, `memo` and `channel` are three FACTORIES over this one class — one
// constructor, one initialisation order, every field written including `undefined`.
// Three constructors differing in which fields they fill is three hidden classes on
// the object every production writes, and `this.status` goes polymorphic in `enter`
// and `wake`. The uniformity bias argues FOR the single shape here.
//
// A room is a node whose `identity` defaults to the reference (5.5) and whose
// triggers are inert (7.13). `headReplaces`, `settles` and `gated` are its three
// fields that are NOT inert, and they are decided here and read, never branched on
// per write.

import { isFailed, isReactive, isThenable } from '../guards.ts'
import { warn } from '../warn.ts'
import { comparator } from './comparator.ts'
import type { Tail } from './face.ts'
import {
    detach,
    EFFECT,
    scheduleFlush,
    type Link,
    MEMO_READER,
    markProvisional,
    Reader,
    revalidate,
    subscribe,
    track,
    untracked,
    wake,
    wasProvisional,
} from './graph.ts'
import { nextWalk, propagated } from './propagated.ts'
import {
    CLEAN,
    CLEARED_BY_A_PRODUCTION,
    CLEARED_BY_A_SETTLE,
    DIRTY,
    DONE,
    ERRORED,
    IN_FLIGHT,
    PENDING,
    PRODUCER_FAILED,
    REFRESHING,
    STALE,
    STREAMING,
    SUCCESS,
    VALUE,
} from './REACTIVE_FLAGS.ts'
import { Ring } from './Ring.ts'
import { validate } from './validate.ts'

export type NodeOptions = {
    schema?: unknown
    transform?: (value: unknown) => unknown
    identity?: unknown
    tail?: number
    ttl?: number
    store?: unknown
}

// What a production sets beside `SUCCESS`. A state and a memo are DONE when a value
// lands; 3.9 keeps a room's `s.done` false while it is live, so a room's is 0.
const SETTLES_DONE = DONE
const SETTLES_NOTHING = 0

export class ReactiveNode {
    value: unknown
    // The VALUE channel's token, bumped by an accepted production alone.
    version: number
    // The STATUS channels' token, bumped by any transition that changed a bit.
    pulse: number
    status: number
    error: unknown
    // The error channel's token, and why a SECOND consecutive rejection wakes.
    errors: number
    // Supersedes a load in flight, bumped by EVERY write. Bumped in `load` alone,
    // `s.set(slowFetch()); s.set(5)` left the stale async value landing over the newer
    // synchronous one eight hundred milliseconds later.
    epoch: number
    subscribers: Link | undefined
    // The owned `Reader` on a memo; `undefined` on a state, a room and a keyed memo
    // (11.25).
    reader: Reader | undefined
    // `propagated`'s diamond mark.
    walk: number
    schema: unknown
    transform: ((value: unknown) => unknown) | undefined
    // The two-argument comparator, NORMALISED ONCE from `fn.length` (5.3) over 5.4's
    // structural default.
    identity: (next: unknown, previous: unknown) => boolean
    // Whether the duplicate gate runs. Off on a room: 5.5 gives a room reference
    // identity precisely so structurally equal messages are not swallowed, and `===`
    // on a primitive IS value equality — a room whose messages are strings would drop
    // its second `'ping'` under 5.2 and the heartbeat would stop.
    gated: boolean
    headReplaces: boolean
    settles: number
    ring: Ring
    // The number `publish` mints (9.7). NOT the `ttl` clock, which lives on the ring:
    // 5.8 forbids minting one on a room and 9.7 has `publish` hand one back, which is
    // two clauses about this and none about the other.
    sequence: number
    // 8.x's backing, phase 9.
    store: unknown
    // What 11.15's members delegate to, phase 7.
    adopted: ReactiveNode | undefined

    constructor(options: NodeOptions, room: boolean, status: number) {
        this.value = undefined
        this.version = 0
        this.pulse = 0
        this.status = status
        this.error = undefined
        this.errors = 0
        this.epoch = 0
        this.subscribers = undefined
        this.reader = undefined
        this.walk = 0
        this.schema = options.schema
        this.transform = options.transform
        this.identity = room
            ? (next, previous) => next === previous
            : comparator(options.identity)
        this.gated = !room
        this.headReplaces = room
        this.settles = room ? SETTLES_NOTHING : SETTLES_DONE
        this.ring = new Ring(
            options.tail ?? 1,
            options.ttl ?? Number.POSITIVE_INFINITY,
        )
        this.sequence = 0
        this.store = options.store
        this.adopted = undefined
    }

    // 2.1 — returns what is held and does not await.
    read(): unknown {
        this.bringUpToDate()
        subscribe(this, VALUE)
        // 2.3 — a producer failed and nothing has landed. 2.4 and 2.5 never set this
        // bit, which is why it is a bit of its own.
        if ((this.status & PRODUCER_FAILED) !== 0) throw this.error
        // 11.59 — the run that read this is PROVISIONAL and mints no production.
        if ((this.status & (SUCCESS | PENDING)) === PENDING) markProvisional()
        return this.value
    }

    // 2.6 — reads as `s` does, except that it does not join the flow.
    peek(): unknown {
        this.bringUpToDate()
        if ((this.status & PRODUCER_FAILED) !== 0) throw this.error
        return this.value
    }

    // A memo is LAZY: 11.5 has it recompute when a value its body read changes, and
    // the recompute happens on the read that follows rather than on the write, which
    // is 5.2's own mechanism — an eager push wakes readers for values that did not
    // change.
    private bringUpToDate(): void {
        const reader = this.reader
        if (reader === undefined || reader.dirty === CLEAN) return
        // A memo over a memo sits at CHECK rather than DIRTY, and recomputing it
        // unconditionally is the eager push wearing a different hat: the inner
        // recompute may have yielded an equal identity, in which case nothing this
        // body reads has moved. `revalidate` is what answers that, per edge and
        // against both tokens.
        if (revalidate(reader)) reader.evaluate()
        else reader.dirty = CLEAN
        // A recompute driven by a READ queues whatever it woke, and outside a flush
        // there is nothing else that would drain it — a memo read at top level would
        // otherwise leave its effects sitting until the next unrelated write. The
        // call is on the cold arm and re-entrant-guarded, so a read inside an effect
        // pays a return.
        scheduleFlush()
    }

    recompute(): void {
        const reader = this.reader
        if (reader === undefined) return
        let computed: unknown
        try {
            computed = track(reader, reader.body as () => unknown)
        } catch (thrown) {
            this.fail(thrown)
            return
        }
        // THE PULSE MOVES ON EVERY RECOMPUTE, and it is not `enter`'s bump. A
        // propagated probe is derived from the SOURCE SET (11.22), and a recompute
        // can change that set without changing this node's own status or value:
        // `memo(() => which() ? settled() : loading())` flipping to the loading arm
        // moves neither `version` nor the status bits, so a reader of `m.pending()`
        // sitting at CHECK resolves both tokens as unmoved, stays clean, and the
        // spinner never appears. The pulse is the STATUS channels' token and a new
        // source set is a new answer on every one of them.
        this.pulse += 1
        // 11.59, D71 — a body run that read a value which had not landed mints no
        // production. The subscriptions the run took are kept, so the landing wakes
        // it again.
        if (wasProvisional()) return
        this.write(computed)
    }

    // 4.1, 4.2 — a settled value or a load, at construction and at every write alike.
    set(incoming: unknown): unknown {
        const refused = this.write(incoming)
        scheduleFlush()
        return refused
    }

    private write(incoming: unknown): unknown {
        // 1.7 before 4.1: a `Reactive` is thenable under 1.5, so the brand is read
        // first or every one of them arrives here as a load.
        if (isReactive(incoming)) return this.produce(incoming)
        return isThenable(incoming)
            ? this.load(incoming as Promise<unknown>)
            : this.produce(incoming)
    }

    produce(incoming: unknown): unknown {
        this.epoch += 1
        if (this.schema !== undefined) {
            // 4.3, 4.5 — the schema runs first, on the settled value, and its throw
            // is converted rather than allowed to escape the write. 14.10 — untracked.
            const validated = untracked(validate, this.schema, incoming)
            if (isFailed(validated)) return this.refuse(validated)
            incoming = validated
        }
        if (this.transform !== undefined) {
            // 4.6, 4.7 — refuses by RETURNING a `Failed`, runs untracked, once per
            // materialisation. 4.8 keeps it off a promise and off a chunk, which is
            // why the chunk path is not this one.
            const shaped = untracked(this.transform, incoming)
            if (isFailed(shaped)) return this.refuse(shaped)
            incoming = shaped
        }
        // `identity` is the author's function and can read a `Reactive`; a write
        // performed inside a live reader run would otherwise plant an edge on that
        // reader — 14.10's hazard, and the `untracked` on the two lines above is what
        // would make its absence here inconsistent.
        const duplicate =
            this.gated &&
            (this.status & SUCCESS) !== 0 &&
            untracked(this.identity, incoming, this.value) === true
        if (!duplicate) {
            this.value = incoming
            this.version += 1
            // 5.8 on a room, 5.9 on a patch; 5.7 has a state and a memo PUSH. The
            // clock, where one is needed at all, is the ring's.
            if (this.headReplaces) this.ring.replaceHead(incoming)
            else {
                this.sequence += 1
                this.ring.push(incoming, this.sequence)
            }
        }
        // A DUPLICATE STILL TRANSITIONS. 5.2 says a matching production is not
        // retained and wakes no reader; it says nothing about the probes, and a probe
        // reader is not a reader under the Terms table. Returning early from the whole
        // method is what left `s.set(fetchSameThing())` with `PENDING` set forever,
        // against 7.11 — an accepted production, which this is, clears the stale mark.
        const changed = this.enter(
            SUCCESS | this.settles,
            CLEARED_BY_A_PRODUCTION,
        )
        const woke = duplicate ? changed : changed | VALUE
        // TRIED AND NOT KEPT: `&& this.subscribers !== undefined`, which is what
        // abideminimal's write does and what its own comment prices at 2.7x — there it
        // saves a `Set` iterator allocation per write, and here there is none to save:
        // `notifySubscribers` is a `for` over a linked list, so the guard buys one call
        // and one null compare. Measured at ~4% and below the resolution of every
        // instrument available under bun — 15.6/15.6/15.9 ns against 16.1/16.2/16.8, and
        // a 31-rep ratio against a fixed reference came back BIMODAL across processes
        // (12.3x and 14.7x, two states rather than noise around one). A branch in a
        // shared path earns its place with a measured ratio and this has none.
        if (woke !== 0) wake(this, woke)
        return undefined
    }

    // 5.9 has `s.patch` MINT a production and REGISTRY has it mutate IN PLACE, so
    // `incoming` is `this.value` — the same reference, already mutated — and the
    // duplicate gate would answer "equal" for every patch under 5.4's structural
    // default. Routed through `produce`, every `s.patch` changed the value and woke
    // nobody, `rows.patch(r => r.reverse())` included. A patch has no separate
    // incoming value to compare, so it does not reach the gate at all.
    patch(mutate: (value: unknown) => void): undefined {
        this.epoch += 1
        // 5.10 — the callback returns nothing. 14.10 — it is not the flow.
        untracked(mutate, this.value)
        this.version += 1
        this.ring.replaceHead(this.value)
        const changed = this.enter(
            SUCCESS | this.settles,
            CLEARED_BY_A_PRODUCTION,
        )
        wake(this, changed | VALUE)
        scheduleFlush()
        return undefined
    }

    private load(promise: Promise<unknown>): undefined {
        this.epoch += 1
        const epoch = this.epoch
        // 3.14 — a load over a landed value that is not stale REFRESHES rather than
        // pends; 7.9 is the stale arm, where it pends.
        const serving = (this.status & (SUCCESS | STALE)) === SUCCESS
        const changed = this.enter(
            serving ? REFRESHING : PENDING,
            serving ? 0 : DONE,
        )
        if (changed !== 0) wake(this, changed)
        promise.then(
            (settled) => {
                if (epoch !== this.epoch) return
                this.produce(settled)
                scheduleFlush()
            },
            (thrown) => {
                if (epoch !== this.epoch) return
                this.fail(thrown)
                scheduleFlush()
            },
        )
        return undefined
    }

    // 4.10 — a refused write fills `s.error` and does not reach a `{:catch}`. 4.9 —
    // it stores nothing and mints no production. 15.2 — the refusal fills `Failures`.
    private refuse(failed: unknown): unknown {
        this.error = failed
        this.errors += 1
        wake(this, this.enter(ERRORED, CLEARED_BY_A_SETTLE) | ERRORED)
        return failed
    }

    fail(thrown: unknown): undefined {
        // 4.12 — a failed revalidation leaves the held value being served and warns.
        if ((this.status & SUCCESS) !== 0)
            warn('abide:reactive', 'a revalidation failed', thrown)
        this.error = thrown
        this.errors += 1
        // 2.3 against 2.4 and 2.5: the throw-on-read bit is set only where nothing
        // has landed.
        const producerFailed =
            (this.status & SUCCESS) === 0 ? PRODUCER_FAILED : 0
        wake(
            this,
            this.enter(ERRORED | producerFailed, CLEARED_BY_A_SETTLE) | ERRORED,
        )
        return undefined
    }

    // THE WHOLE PROBE MACHINERY: an OR, an AND-NOT, an XOR and a pulse, and the result
    // is the wake mask.
    //
    // `ERRORED` is forced into the mask by both callers above the way `VALUE` is,
    // because `enter` reports a TRANSITION and a second consecutive rejection is
    // ERRORED set → set, whose XOR is zero: the reader kept rendering the first error
    // while the second sat in `s.error`. The mask has no channel for "same bit, new
    // payload", and the two places that is true are the value, which has `version`,
    // and the error, which has `errors`.
    private enter(set: number, clear: number): number {
        const status = (this.status | set) & ~clear
        const changed = status ^ this.status
        this.status = status
        if (changed !== 0) this.pulse += 1
        return changed
    }

    // 3.1 — a probe does not throw. 3.2 — a probe starts no work, which is why none
    // of the five below calls `settle`. 3.3 — reading one subscribes to it alone.
    pending(): boolean {
        subscribe(this, PENDING)
        if ((this.status & PENDING) !== 0) return true
        // 11.21 and D69 — an unkeyed memo reports pending for its own load, or for
        // any value its body read. 11.25 has a keyed memo propagate nothing, which is
        // the `reader === undefined` arm.
        if (this.reader === undefined) return false
        return propagated(this, PENDING, nextWalk())
    }

    refreshing(): boolean {
        subscribe(this, REFRESHING)
        if ((this.status & REFRESHING) !== 0) return true
        if (this.reader === undefined) return false
        return propagated(this, REFRESHING, nextWalk())
    }

    // 3.8 keeps this true through `s.refresh`, which is why `DONE` is not in
    // `CLEARED_BY_A_PRODUCTION` and not cleared by the refreshing arm of `load`.
    done(): boolean {
        subscribe(this, DONE)
        if ((this.status & DONE) === 0) return false
        if (this.reader === undefined) return true
        // 11.20 has `done` propagate, and the only direction that can mean is that a
        // memo over a source still in flight has not finished.
        return !propagated(this, PENDING, nextWalk())
    }

    // 3.13 — does not move for a load in flight, which is why no path here clears it.
    // 3.10 — orthogonal to `s.error`.
    success(): boolean {
        subscribe(this, SUCCESS)
        return (this.status & SUCCESS) !== 0
    }

    streaming(): boolean {
        subscribe(this, STREAMING)
        return (this.status & STREAMING) !== 0
    }

    readError(): unknown {
        subscribe(this, ERRORED)
        return (this.status & ERRORED) !== 0 ? this.error : undefined
    }

    // 7.7 and 7.13 — inert on a value with no producer and on a room. A state holding
    // what an app put there has nothing to reload.
    private producing(): boolean {
        return (
            !this.headReplaces &&
            (this.reader !== undefined || this.store !== undefined)
        )
    }

    // 7.2 drops the cache behind the value and not the value; 7.8 marks it stale; 7.10
    // keeps it being served. 7.3 has it MOVE NO NODE, which is why the memo's reader
    // is marked directly rather than through `notify` — a notify would push CHECK to
    // every subscriber and re-render them.
    invalidate(): undefined {
        if (!this.producing()) return undefined
        this.enter(STALE, 0)
        const reader = this.reader
        if (reader !== undefined) reader.dirty = DIRTY
        return undefined
    }

    // 7.4 keeps serving what is held; 7.5 reports refreshing while the reload is in
    // flight; 7.14 reloads whether or not anything subscribes.
    refresh(): undefined {
        if (!this.producing()) return undefined
        const reader = this.reader
        if (reader === undefined) return undefined
        reader.dirty = DIRTY
        this.recompute()
        scheduleFlush()
        return undefined
    }

    // 2.12 and 2.13 — `s.then` resolves with the value where `s.pending` becomes
    // false and 2.3 would not throw, and rejects with what 2.3 throws. 1.6 derives
    // `catch` and `finally` from it, on the face.
    settled(): Promise<unknown> {
        if ((this.status & IN_FLIGHT) === 0) return this.settledNow()
        return new Promise((resolve, reject) => {
            const reader = new Reader(EFFECT, undefined, () => {
                this.pending()
                this.refreshing()
                this.streaming()
                if ((this.status & IN_FLIGHT) !== 0) return
                reader.stopped = true
                detach(reader)
                if ((this.status & PRODUCER_FAILED) !== 0) reject(this.error)
                else resolve(this.value)
            })
            reader.evaluate()
        })
    }

    private settledNow(): Promise<unknown> {
        if ((this.status & PRODUCER_FAILED) !== 0)
            return Promise.reject(this.error)
        return Promise.resolve(this.value)
    }

    // 2.8 — replays the retained snapshot and then continues live from where that
    // snapshot ended, with no gap and no repeat. 2.9 — the argument is replay depth
    // alone, bounded above by what is retained.
    tail(depth?: number): Tail<unknown> {
        const replay = this.ring.snapshot(depth ?? Number.POSITIVE_INFINITY)
        const from = this.version
        return {
            [Symbol.iterator]: () => replay[Symbol.iterator](),
            [Symbol.asyncIterator]: () => this.cursor(replay, from),
        }
    }

    // 2.11 — yields the production in flight from its start, and then continues live.
    live(): AsyncIterator<unknown> {
        const held = (this.status & SUCCESS) !== 0 ? [this.value] : []
        return this.cursor(held, this.version)
    }

    // 6.7 — a live cursor does not observe an expiry: it holds the replayed values
    // itself and reads the node for what follows, so the ring dropping an entry is
    // invisible to it.
    private cursor(replay: unknown[], from: number): AsyncIterator<unknown> {
        const queued: unknown[] = replay.slice()
        let waiting: ((result: IteratorResult<unknown>) => void) | undefined
        let seen = from
        const reader = new Reader(EFFECT, undefined, () => {
            this.read()
            if (this.version === seen) return
            seen = this.version
            if (waiting !== undefined) {
                const resume = waiting
                waiting = undefined
                resume({ value: this.value, done: false })
                return
            }
            queued.push(this.value)
        })
        reader.evaluate()
        return {
            next(): Promise<IteratorResult<unknown>> {
                if (queued.length > 0)
                    return Promise.resolve({
                        value: queued.shift(),
                        done: false,
                    })
                return new Promise((resolve) => {
                    waiting = resolve
                })
            },
            return(): Promise<IteratorResult<unknown>> {
                reader.stopped = true
                detach(reader)
                return Promise.resolve({ value: undefined, done: true })
            },
        }
    }
}

// A memo's reader, built here rather than in `memo.ts` so the node and the reader are
// joined in one place and `reader.node === node` can never be false.
export function attachReader(node: ReactiveNode, body: () => unknown): void {
    node.reader = new Reader(MEMO_READER, node, body)
}
