// The keyed face. One entry per `Args` key (RULEBOOK 11.4), computed when that key is
// REACHED rather than on every read — 1.7 puts the start at the reach, and 1.8 has a
// second reach join the standing work rather than start a second.
//
// The static members are the probes and triggers narrowed to matching entries. The
// allocate/do-not-allocate split is carried by the SPELLING: `keyed(args)` reaches an
// entry and starts it, `keyed.busy(pattern)` reads the map and allocates nothing.

import type { Failed } from '../Failed.ts'
import { checkArgs } from '../refuse.ts'
import type { Schema } from '../Schema.ts'
import {
    ARGS_GATE,
    type Gated,
    normalised,
    PARAMETER_DEFAULTS,
} from './argsContract.ts'
import { CELL } from './CELL.ts'
import { canonicalKey } from './canonicalKey.ts'
import { ENTRY_LIVES } from './ENTRY_LIVES.ts'
import { armTimer } from './Expiry.ts'
import { KEYED_BRAND } from './KEYED_BRAND.ts'
import { matchesPattern } from './matchesPattern.ts'
import { NotLanded } from './NotLanded.ts'
import { parameterDefaults } from './parameterDefaults.ts'
import {
    abandonDeferred,
    createReactive,
    failedTransiently,
    isStreamBody,
    leaveSelections,
    type Reactive,
    type ReactiveOptions,
    refuseBothCaps,
    signalMoved,
    startDeferred,
} from './Reactive.ts'
import {
    detach,
    detachProbes,
    dropReader,
    newSubscriber,
    newTracked,
    type Subscriber,
    TRACKING,
    type Tracked,
    trackProbe,
} from './tracking.ts'

/**
 * The keyed face: one `Reactive` per `Args` key, plus the probes and triggers over its entries.
 *
 * The argument is optional where `Args` admits `undefined`, so a keyed value whose args may be
 * absent is reached as `presence()`.
 */
export type Keyed<
    Stored,
    Args,
    Accepted = Stored,
    Failures = never,
    Produced = Stored,
> = ((
    ...args: undefined extends Args ? [args?: Args] : [args: Args]
) => Reactive<Stored, Accepted, Failures, Produced>) & {
    busy(pattern?: Partial<Args>): boolean
    ready(pattern?: Partial<Args>): boolean
    refresh(pattern?: Partial<Args>): void
    invalidate(pattern?: Partial<Args>): void
    /** The entries reached so far. Not app surface — the statics and the tests read it. */
    entries: Map<string, Reactive<Stored, Accepted, Failures>>
}

/** Whether `value` is a `Keyed`, read off its brand rather than its shape (16.5). */
export function isKeyed(
    value: unknown,
): value is Keyed<unknown, unknown, unknown, never, unknown> & Gated<unknown> {
    return (
        typeof value === 'function' &&
        (value as { [KEYED_BRAND]?: boolean })[KEYED_BRAND] === true
    )
}

/**
 * What an entry was keyed on, read off its own record rather than a second map beside `entries`.
 *
 * The args are the entry's body argument and its cell already holds them for every run.
 */
function argsOf(entry: unknown): unknown {
    return (entry as { [CELL]: { args: unknown } })[CELL].args
}

// One entry of `Lifetime.followed`, which is in recency order: what an eviction needs beside when
// the entry last produced.
type Follower = {
    at: number
    ms: number
    cell: Tracked & { servable: boolean; loading: boolean }
    reader: Subscriber
    evict: () => void
}

/**
 * The life of every entry of one `Keyed`, evicting each once `ttl` passes without a production.
 *
 * 11.45, 11.48, 11.49 — allocated only where a `ttl` was declared.
 *
 * RECENCY IS THE ORDER OF A MAP. A production moves its key to the end by deleting and re-setting
 * it, so the oldest entry is always the first one and 11.48's "armed at the oldest" is one
 * iterator step rather than a scan — and the sweep stops at the first entry still inside its
 * life, the way `dropExpired` stops at the first live production.
 *
 * THE PRODUCTION IS HEARD BY A MIRROR ON EACH ENTRY, which is what the refusal that stood here
 * said could not be had without a hook on every cell in the design. A mirror is a reader, so only
 * an entry of a keyed value declaring `ttl` pays for one, and it runs in the mark walk rather than
 * at the end of the turn — so the clock read is the production's own moment. It is also woken by
 * a cascade that is not a production (an `invalidate`, an abort), and `servable` is what tells
 * those apart: every one of them leaves nothing to serve, where a production always leaves
 * something.
 */
class Lifetime {
    ms: number
    followed: Map<string, Follower>
    timer: ReturnType<typeof setTimeout> | null

    constructor(ms: number) {
        this.ms = ms
        this.followed = new Map()
        this.timer = null
    }

    follow(key: string, entry: { [CELL]: Tracked }, evict: () => void): void {
        // 11.33: `Infinity` is the life of the scope, which no timer here can reach.
        if (this.ms === Number.POSITIVE_INFINITY) return
        const cell = entry[CELL] as Follower['cell']
        // A MIRROR WITH NO ADOPTER — `Subscriber.isMirror` says why.
        const reader = newSubscriber([cell], null, true)
        const follower: Follower = { at: 0, ms: this.ms, cell, reader, evict }
        ENTRY_LIVES.set(cell, follower)
        reader.notify = (): void => {
            // Or a parked entry's load ended with nothing to serve — a refusal ends a load too.
            if (cell.servable || (!cell.loading && !this.followed.has(key)))
                this.touch(key, follower)
        }
        cell.readers.push(reader)
        // 11.69 — AND ITS PROBES, so a load ending is heard as one: the sweep parks an entry whose
        // load is in flight, and this is what starts its life again once the load is over.
        trackProbe(cell, reader)
        // The life starts at the reach: an entry whose load never lands still ends.
        this.touch(key, follower)
    }

    touch(key: string, follower: Follower): void {
        follower.at = Date.now()
        this.followed.delete(key)
        this.followed.set(key, follower)
        // THE STANDING TIMER IS LEFT WHERE IT IS. It is armed at an entry at least as old as
        // this one, so it fires no later than anything this touch could need — at worst
        // early, and an early fire evicts nothing and re-arms. Re-arming here would be a
        // `setTimeout` per production.
        if (this.timer === null) this.arm()
    }

    arm(): void {
        for (const oldest of this.followed.values()) {
            armTimer(this, oldest.at + this.ms - Date.now(), () => {
                this.sweep()
            })
            return
        }
    }

    sweep(): void {
        this.timer = null
        const deadline = Date.now() - this.ms
        for (const [key, follower] of this.followed) {
            if (follower.at > deadline) break
            this.followed.delete(key)
            // 11.69 — PARKED, NOT EVICTED: a call reaching it joins the load, and the load's end
            // touches it back into the order.
            if (follower.cell.loading) continue
            follower.reader.alive = false
            dropReader(follower.cell, follower.reader)
            detachProbes(follower.reader)
            follower.evict()
        }
        this.arm()
    }
}

/**
 * One throttle or debounce window for a whole keyed face, holding back starting what it reaches.
 *
 * 5.19, 5.20, 5.21. A throttle starts the first key at once and the latest reached inside its
 * window when it ends; a debounce starts the latest once the reaches stop. Either way only the
 * LATEST held key starts — one reached and then superseded inside a window is work the window
 * would discard (5.11), so it is abandoned and dropped instead.
 */
class StartWindow {
    leading: boolean
    ms: number
    timer: ReturnType<typeof setTimeout> | null
    pending: { entry: unknown; drop: () => void } | null

    constructor(leading: boolean, ms: number) {
        this.leading = leading
        this.ms = ms
        this.timer = null
        this.pending = null
    }

    reached(entry: unknown, drop: () => void): void {
        if (this.leading && this.timer === null) {
            startDeferred(entry)
            this.open()
            return
        }
        const superseded = this.pending
        if (superseded !== null) {
            abandonDeferred(superseded.entry)
            superseded.drop()
        }
        this.pending = { entry, drop }
        if (!this.leading) this.open()
    }

    open(): void {
        if (this.timer !== null) clearTimeout(this.timer)
        armTimer(this, this.ms, () => {
            this.timer = null
            const held = this.pending
            if (held === null) return
            this.pending = null
            startDeferred(held.entry)
            // A throttle's window reopens behind what it just started, as a value's does (5.12).
            if (this.leading) this.open()
        })
    }
}

/**
 * `body` behind the `args` gate: validate, then run the body with what the gate accepted.
 *
 * 11.27's LAST TWO STEPS as one body. The gate runs on every run of the entry — a refresh
 * re-validates — and throws the refusal, which is what a body failing already does: the entry's
 * `error` holds it and its read throws it (2.2), and the body the gate stands in front of is never
 * called. What it accepts is what the body is handed (11.68).
 *
 * A STREAM STAYS A STREAM FROM CONSTRUCTION. 9.6 reads the body's KIND, so the wrapper around an
 * async generator is an async generator, or a gated keyed stream would be one only from its first
 * run.
 */
function gated<Args>(
    body: (args: Args) => unknown,
    gate: Schema<Args>,
): (args: Args) => unknown {
    const check = (args: Args): Args => checkArgs(gate, args)
    if (isStreamBody(body))
        return async function* (args: Args) {
            yield* (body as (args: Args) => AsyncIterable<unknown>)(check(args))
        }
    return (args: Args): unknown => body(check(args))
}

/**
 * `body` wrapped so the entry drops what it read once a run completes, keeping it only on an abort.
 *
 * 14.4, 11.6 AND 11.23: AN ENTRY KEEPS NOTHING IT READ past a run that completed, so a value its
 * body read changing neither recomputes it nor makes it busy — `ttl`, a trigger and eviction are
 * its only ways back. The run still TRACKS, and has to: a body aborted on a value that has not
 * landed is brought back by the subscription its read made (2.13), so an abort is the one exit
 * that keeps what it read.
 *
 * HERE RATHER THAN IN `run`. A test in `run` is paid by every recompute of every unkeyed value in
 * the graph, and measured at 6-9% on a chain of twenty under V8 for a case no unkeyed value
 * reaches; wrapping the entry's body is paid by an entry's run alone. The run has set the entry as
 * the reader by the time this is called, so dropping its sources here leaves `run` finding nothing
 * past its cursor to trim.
 */
function heldOnce<Args>(
    body: (args: Args) => unknown,
): (args: Args) => unknown {
    // A stream's body runs untracked already (14.13), so there is nothing for it to keep.
    if (isStreamBody(body)) return body
    return (args: Args): unknown => {
        const entry = TRACKING.reader
        let produced: unknown
        try {
            produced = body(args)
        } catch (thrown) {
            if (entry !== null && !(thrown instanceof NotLanded)) detach(entry)
            throw thrown
        }
        if (entry !== null) detach(entry)
        return produced
    }
}

/** Builds the keyed face over `body`: a reach per `Args` key, carrying brand, gate and statics. */
export function createKeyed<
    Stored,
    Args,
    Accepted,
    Failures extends Failed<string, unknown>,
>(
    label: string,
    body: (args: Args) => unknown,
    options: ReactiveOptions<Accepted, Stored, never, Args> | undefined,
): Keyed<Stored, Args, Accepted, Failures> & Gated<Args> {
    const entries = new Map<string, Reactive<Stored, Accepted, Failures>>()
    // 11.45: A KEYED `ttl` IS THE LIFE OF AN ENTRY, not of a production inside one, so it is
    // taken off the options every entry is built from — forwarded, it would build the
    // unkeyed mechanism in every entry and evict nothing from this map.
    const { ttl, args, throttle, debounce, ...rest } = options ?? {}
    const gate = args as Schema<Args> | undefined
    const entryOptions = rest
    // 5.14, at the factory: a keyed value is capped one way or the other.
    refuseBothCaps(`${label}()`, throttle, debounce)
    // 5.19: A KEYED VALUE'S WINDOW HOLDS BACK STARTING A KEY, rather than capping each entry's wakes.
    const starts =
        throttle === undefined && debounce === undefined
            ? null
            : new StartWindow(
                  throttle !== undefined,
                  (throttle ?? debounce) as number,
              )
    const lifetime = ttl === undefined ? null : new Lifetime(ttl)
    const entryBody = heldOnce(gate === undefined ? body : gated(body, gate))
    // 11.27, 11.29 — the defaults are applied before the key is taken, so the entry is one for a
    // call that wrote them and one that left them to the parameter. Read once, here: a body with
    // none pays a `null` test per reach.
    const defaults = parameterDefaults(body)
    // WHICH KEYS EXIST IS ITSELF SOMETHING `busy` AND `ready` ANSWER FROM (13.2, 13.11), and no
    // entry's probe carries it: a guard asked before a key was reached subscribed to the entries
    // there were, so the key that starts loading next — search-as-you-type — never woke it. One
    // signal per `Keyed`, moved where an entry is reached and where one is released.
    const membership = newTracked()

    function askMembership(): void {
        const reader = TRACKING.reader
        if (reader !== null) trackProbe(membership, reader)
    }

    // Out of the map and out of every selection with it, rather than reachable by a sweep until a
    // collection happens to run.
    function release(
        key: string,
        created: Reactive<Stored, Accepted, Failures>,
    ): void {
        entries.delete(key)
        leaveSelections(created)
        signalMoved(membership)
    }

    function reach(given: Args): Reactive<Stored, Accepted, Failures> {
        const args = normalised(self, given)
        const key = canonicalKey(args)
        const standing = entries.get(key)
        // 1.8: reaching an instance that exists joins the standing work — 15.19, unless that work
        // failed transiently, which this reach runs again.
        if (standing !== undefined) {
            if (failedTransiently(standing)) standing.refresh()
            return standing
        }
        const created = createReactive<Stored, Accepted, Failures>(
            `${label}(${key})`,
            entryBody as (args: unknown) => unknown,
            args,
            undefined,
            entryOptions as ReactiveOptions<Accepted, Stored, Failures>,
            starts !== null,
            true,
        )
        entries.set(key, created)
        if (lifetime !== null)
            lifetime.follow(
                key,
                created as unknown as { [CELL]: Tracked },
                () => {
                    release(key, created)
                },
            )
        if (starts !== null)
            starts.reached(created, () => {
                // 5.20: superseded before it started — not held, so a later reach starts afresh.
                if (entries.get(key) === created) release(key, created)
            })
        signalMoved(membership)
        return created
    }

    // A KEYED VALUE IS ITS REACH, with the brand, the gate, the entries and the four statics on it.
    const self = Object.assign(reach, {
        [KEYED_BRAND]: true,
        [ARGS_GATE]: gate,
        [PARAMETER_DEFAULTS]: defaults,
        entries,
        busy: (pattern?: Partial<Args>): boolean => {
            askMembership()
            for (const entry of entries.values())
                if (matchesPattern(argsOf(entry), pattern) && entry.busy())
                    return true
            return false
        },
        // ALL rather than ANY, and the quantifiers are not a pair of preferences: `busy`
        // asks whether anything is loading, `ready` whether everything is servable, and
        // that is the only pairing under which `busy && !ready` reads as one sentence.
        ready: (pattern?: Partial<Args>): boolean => {
            askMembership()
            for (const entry of entries.values())
                if (matchesPattern(argsOf(entry), pattern) && !entry.ready())
                    return false
            return true
        },
        refresh: (pattern?: Partial<Args>): void => {
            for (const entry of entries.values())
                if (matchesPattern(argsOf(entry), pattern)) entry.refresh()
        },
        invalidate: (pattern?: Partial<Args>): void => {
            for (const entry of entries.values())
                if (matchesPattern(argsOf(entry), pattern)) entry.invalidate()
        },
    }) satisfies Gated<Args>
    return self as Keyed<Stored, Args, Accepted, Failures> & Gated<Args>
}
