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
import { endRun } from './abortSignal.ts'
import {
    ARGS_GATE,
    canonicalKey,
    type Gated,
    heldArgs,
    normalized,
    PARAMETER_DEFAULTS,
} from './argsContract.ts'
import { armTimer, armWindow } from './armTimer.ts'
import { CELL } from './CELL.ts'
import {
    type Cell,
    cellOf,
    type HoldsCell,
    refuseBothCaps,
} from './cellShape.ts'
import type { ArgsTuple } from './createMemo.ts'
import { isReactive } from './isReactive.ts'
import { KEYED_BRAND } from './KEYED_BRAND.ts'
import { matchesPattern } from './matchesPattern.ts'
import { NotLanded } from './NotLanded.ts'
import { parameterDefaults } from './parameterDefaults.ts'
import {
    abandonDeferred,
    type CellOptions,
    createReactive,
    failedTransiently,
    isStreamBody,
    type Reactive,
    signalMoved,
    startDeferred,
    subscribed,
    unwatchStore,
} from './Reactive.ts'
import { leaveSelections } from './selections.ts'
import { SERVED_BODIES, SERVES_NO_REACTIVE } from './SERVED_BODIES.ts'
import {
    detach,
    detachProbes,
    dropReader,
    newSubscriber,
    newTracked,
    type Subscriber,
    TRACKING,
    trackProbe,
} from './tracking.ts'
import { owned, owning } from './watch.ts'

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
    ...args: ArgsTuple<Args>
) => Reactive<Stored, Accepted, Failures, Produced>) & {
    busy(pattern?: Partial<Args>): boolean
    ready(pattern?: Partial<Args>): boolean
    synced(pattern?: Partial<Args>): boolean
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
        (value as { [KEYED_BRAND]?: boolean | undefined })[KEYED_BRAND] === true
    )
}

/**
 * What an entry was keyed on, read off its own record rather than a second map beside `entries`.
 *
 * The args are the entry's body argument and its cell already holds them for every run.
 */
function argsOf(entry: unknown): unknown {
    return cellOf(entry).args
}

// One entry of `Lifetime.followed`, which is in recency order: what an eviction needs beside when
// the entry last produced.
type Follower = {
    key: string
    at: number
    ms: number
    cell: Cell
    reader: Subscriber
    evict: () => void
}

/**
 * Each followed entry's `Follower`, by its cell: when it last produced, and how long it lives (11.45).
 */
const ENTRY_LIVES = new WeakMap<Cell, Follower>()

/**
 * When the entry `cell` is stops being servable, by its `Keyed`'s `ttl` — infinity where it is no
 * followed entry. What `deadlineOf` reads beside the value's own `ttl` (21.8).
 */
export function entryDeadline(cell: Cell): number {
    const entry = ENTRY_LIVES.get(cell)
    return entry === undefined ? Number.POSITIVE_INFINITY : entry.at + entry.ms
}

/**
 * The life of every entry of one `Keyed`, evicting each once `ttl` passes without a production.
 *
 * 11.45, 11.48, 6.3 — allocated only where a `ttl` was declared.
 *
 * RECENCY IS THE ORDER OF A MAP. A production moves its key to the end by deleting and re-setting
 * it, so the oldest entry is always the first one and 11.48's "armed at the oldest" is one
 * iterator step rather than a scan — and the sweep stops at the first entry still inside its
 * life.
 *
 * THE PRODUCTION IS HEARD BY A MIRROR ON EACH ENTRY, which is what the refusal that stood here
 * said could not be had without a hook on every cell in the design. A mirror is a reader, so only
 * an entry of a keyed value declaring `ttl` pays for one, and it runs in the mark walk rather than
 * at the end of the turn — so the clock read is the production's own moment. It is also woken by
 * a cascade that is not a production (an `invalidate`, an abort), and `servable` is what tells
 * those apart: every one of them leaves nothing to serve, where a production always leaves
 * something.
 */
function end(follower: Follower): void {
    follower.reader.alive = false
    dropReader(follower.cell, follower.reader)
    detachProbes(follower.reader)
    follower.evict()
}

class Lifetime {
    ms: number
    /** 6.6 — how long past `ms` an entry nothing subscribes to is kept to revalidate; 0 keeps none. */
    staleMs: number
    followed: Map<string, Follower>
    /**
     * 6.6 — the entries whose life ran out with nothing subscribed, kept `staleMs` longer: in the order
     * their lives ran out, which is `followed`'s order, so the oldest is again the first. Made on the
     * first one, so a `Keyed` declaring no `staleIfError` never holds one.
     */
    expired: Map<string, Follower> | null
    timer: ReturnType<typeof setTimeout> | null
    /** When `timer` fires — what a touch compares against where `expired` can have armed it late. */
    due: number

    constructor(ms: number, staleMs: number) {
        this.ms = ms
        this.staleMs = staleMs
        this.followed = new Map()
        this.expired = null
        this.timer = null
        this.due = 0
    }

    follow(key: string, entry: HoldsCell, evict: () => void): void {
        // 11.33: `Infinity` is the life of the scope, which no timer here can reach.
        if (this.ms === Number.POSITIVE_INFINITY) return
        const cell = entry[CELL]
        // A MIRROR WITH NO ADOPTER — `Subscriber.isMirror` says why.
        const reader = newSubscriber([cell], null, true)
        const follower: Follower = {
            key,
            at: 0,
            ms: this.ms,
            cell,
            reader,
            evict,
        }
        ENTRY_LIVES.set(cell, follower)
        reader.notify = (): void => {
            // Or a parked entry's load ended with nothing to serve — a refusal ends a load too.
            if (cell.servable || (!cell.loading && !this.followed.has(key)))
                this.touch(key, follower)
        }
        cell.readers.push(reader)
        // 11.68 — AND ITS PROBES, so a load ending is heard as one: the sweep parks an entry whose
        // load is in flight, and this is what starts its life again once the load is over.
        trackProbe(cell, reader)
        // The life starts at the reach: an entry whose load never lands still ends.
        this.touch(key, follower)
    }

    touch(key: string, follower: Follower): void {
        follower.at = Date.now()
        this.followed.delete(key)
        this.followed.set(key, follower)
        const expired = this.expired
        if (expired !== null) expired.delete(key)
        // THE STANDING TIMER IS LEFT WHERE IT IS. It is armed at an entry at least as old as
        // this one, so it fires no later than anything this touch could need — at worst
        // early, and an early fire evicts nothing and re-arms. Re-arming here would be a
        // `setTimeout` per production. Save where 6.6 keeps expired entries: the timer may stand at
        // one's later release, and this life ends before it.
        if (
            this.timer === null ||
            (expired !== null && follower.at + this.ms < this.due)
        )
            this.arm()
    }

    arm(): void {
        let due = Number.POSITIVE_INFINITY
        for (const oldest of this.followed.values()) {
            due = oldest.at + this.ms
            break
        }
        if (this.expired !== null)
            for (const oldest of this.expired.values()) {
                due = Math.min(due, oldest.at + this.ms + this.staleMs)
                break
            }
        this.due = due
        if (due !== Number.POSITIVE_INFINITY)
            armTimer(this, due - Date.now(), () => {
                this.sweep()
            })
    }

    sweep(): void {
        this.timer = null
        const deadline = Date.now() - this.ms
        for (const [key, follower] of this.followed) {
            if (follower.at > deadline) break
            this.followed.delete(key)
            // 11.68 — PARKED, NOT EVICTED: a call reaching it joins the load, and the load's end
            // touches it back into the order.
            if (follower.cell.loading) continue
            this.ranOut(follower, false)
        }
        // 6.7 — what 6.6 kept and nothing reached for `staleMs` is released.
        const expired = this.expired
        if (expired !== null) {
            const released = deadline - this.staleMs
            for (const [key, follower] of expired) {
                if (follower.at > released) break
                expired.delete(key)
                // Subscribed since by a reader that held the entry rather than reaching its key.
                if (subscribed(follower.cell)) this.ranOut(follower, true)
                else end(follower)
            }
        }
        this.arm()
    }

    /**
     * 6.1, 6.2 — AN ENTRY WHOSE LIFE RAN OUT IS REFRESHED WHERE SOMETHING FOLLOWS IT, and released
     * where nothing does. Out of the order either way: a refresh parks it as a load in flight does
     * (11.68), and what lands touches it back in, so its age counts from the landing (6.3). A life of
     * 0 — a mutation's, 16.7 — and a mutation's entry are released whoever follows them (6.5): refreshed,
     * the one would run its body on every turn and the other send its write again (13.16).
     *
     * 6.6, 6.8 — AND WHERE `staleIfError` KEEPS IT, one nothing follows that serves a value is kept
     * rather than released, and the reach that finds it — `reached` — refreshes it as 6.1 does.
     */
    ranOut(follower: Follower, reached: boolean): boolean {
        const cell = follower.cell
        if (this.ms === 0 || cell.mutation) {
            end(follower)
            return true
        }
        if (!subscribed(cell)) {
            if (this.staleMs === 0 || !cell.servable) {
                end(follower)
                return true
            }
            if (!reached) {
                this.expired ??= new Map()
                this.expired.set(follower.key, follower)
                return false
            }
        }
        ;(cell.reactive as Reactive<unknown>).refresh()
        // A refresh that started no load — a store answering at once — landed already.
        if (!cell.loading) this.touch(follower.key, follower)
        return false
    }

    /**
     * Evicts `key`'s entry where its life has run out and no load holds it, and says whether it did.
     *
     * THE REACH'S HALF of the sweep: a timer that has not fired yet — a `ttl` of 0 is past as the
     * entry produces — leaves an entry a reach would otherwise join. 16.7's mutation called twice in one turn is the case: the second call is a second write.
     */
    outlived(key: string): boolean {
        // 6.8 — kept past its life by 6.6, and reached: revalidated in place.
        const kept = this.expired?.get(key)
        if (kept !== undefined) {
            ;(this.expired as Map<string, Follower>).delete(key)
            return this.ranOut(kept, true)
        }
        const follower = this.followed.get(key)
        if (
            follower === undefined ||
            follower.cell.loading ||
            Date.now() - follower.at < this.ms
        )
            return false
        this.followed.delete(key)
        return this.ranOut(follower, true)
    }
}

/**
 * One throttle or debounce window for a whole keyed face, holding back starting what it reaches.
 *
 * 5.18, 5.19, 5.20. The face's FIRST key starts at once under either: nothing was standing for it
 * to delay a change from, and a render waiting on the value (41.4) would otherwise go out without
 * it. Past that, a throttle starts a key at once where no window is open and the latest reached
 * inside one when it ends; a debounce starts the latest once the reaches stop. Either way only the
 * LATEST held key starts — one reached and then superseded inside a window is work the window
 * would discard (5.11), so it is abandoned and dropped instead.
 */
class StartWindow {
    leading: boolean
    ms: number
    timer: ReturnType<typeof setTimeout> | null
    pending: { entry: unknown; drop: () => void } | null
    started: boolean

    constructor(leading: boolean, ms: number) {
        this.leading = leading
        this.ms = ms
        this.timer = null
        this.pending = null
        this.started = false
    }

    reached(entry: unknown, drop: () => void): void {
        if (!this.started || (this.leading && this.timer === null)) {
            this.started = true
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
        armWindow(this, this.ms, () => {
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
 * `body` handed what the `args` gate accepted for one entry (11.67), rather than the args it was
 * reached with.
 *
 * A STREAM STAYS A STREAM FROM CONSTRUCTION. 9.6 reads the body's KIND, so the wrapper around an
 * async generator is an async generator, or a gated keyed stream would be one only from its first
 * run.
 */
function handed<Args>(
    body: (args: Args) => unknown,
    accepted: Args,
): (args: Args) => unknown {
    if (isStreamBody(body))
        return async function* () {
            yield* (body as (args: Args) => AsyncIterable<unknown>)(accepted)
        }
    return (): unknown => body(accepted)
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
    // 16.109 — a handler's body answering a `Reactive` refuses, rather than the entry adopting it.
    const servesNoReactive = SERVED_BODIES.has(body)
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
        if (servesNoReactive && isReactive(produced))
            throw new TypeError(SERVES_NO_REACTIVE)
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
    options: CellOptions<Accepted, Stored, never, Args> | undefined,
): Keyed<Stored, Args, Accepted, Failures> & Gated<Args> {
    const entries = new Map<string, Reactive<Stored, Accepted, Failures>>()
    // 11.45: A KEYED `ttl` IS THE LIFE OF AN ENTRY, kept by the `Lifetime` below; on the entry it is
    // only what a `store` is handed as its retention (8.13).
    // 5.18, 5.24: `throttle` AND `debounce` STAY ON THE ENTRY TOO — the window below holds back
    // starting a key, and each entry's own caps what it produces once started: a key reached anew and
    // a held key's new value are each paced, and every follower of an entry with it (16.110).
    const { args, staleIfError, ...entryOptions } = options ?? {}
    const { ttl, throttle, debounce } = entryOptions
    const gate = args as Schema<Args> | undefined
    // 5.14, at the factory: a keyed value is capped one way or the other.
    refuseBothCaps(`${label}()`, throttle, debounce)
    // 5.18: A KEYED VALUE'S WINDOW HOLDS BACK STARTING A KEY.
    const starts =
        throttle === undefined && debounce === undefined
            ? null
            : new StartWindow(
                  throttle !== undefined,
                  (throttle ?? debounce) as number,
              )
    const lifetime =
        ttl === undefined ? null : new Lifetime(ttl, staleIfError ?? 0)
    const entryBody = heldOnce(body)
    // 11.27, 11.29 — the defaults are applied before the key is taken, so the entry is one for a
    // call that wrote them and one that left them to the parameter. Read once, here: a body with
    // none pays a `null` test per reach.
    const defaults = parameterDefaults(body)
    // WHICH KEYS EXIST IS ITSELF SOMETHING `busy` AND `ready` ANSWER FROM (13.2, 13.11), and no
    // entry's probe carries it: a guard asked before a key was reached subscribed to the entries
    // there were, so the key that starts loading next — search-as-you-type — never woke it. One
    // signal per `Keyed`, moved where an entry is reached and where one is released.
    const membership = newTracked()
    // 8.21 — A `Keyed` BUILT IN A SETUP OR A REQUEST ends with it, and every store its entries
    // watch is stopped then: the entries are the cache's, so no owner of their own stops them.
    if (options?.store !== undefined && owning())
        owned(() => {
            for (const entry of entries.values()) unwatchStore(entry)
        })

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
        const cell = cellOf(created)
        // 7.23 — an entry released is a run nothing will read, so its signal says stop.
        endRun(cell)
        leaveSelections(created)
        unwatchStore(created)
        // A SETTLED ENTRY LEAVING MOVES NO PROBE: `busy` asks whether any entry loads and `ready`
        // whether every one serves (13.2, 13.11), and one that served and was not loading is neither
        // answer's reason — so a 16.7 mutation's entry, let go as it lands, wakes no reader.
        if (cell.loading || !cell.servable) signalMoved(membership)
    }

    function reach(given: Args): Reactive<Stored, Accepted, Failures> {
        const normal = normalized(self, given)
        const key = canonicalKey(normal)
        const standing = lifetime?.outlived(key) ? undefined : entries.get(key)
        // 1.8: reaching an instance that exists joins the standing work — 15.19, unless that work
        // failed transiently, which this reach runs again.
        if (standing !== undefined) {
            if (failedTransiently(standing)) standing.refresh()
            return standing
        }
        // 16.43 — THE ARGS AS THEY WERE AT THE CALL, kept by the entry: the caller's object is
        // theirs to change after, and a refresh that read it then would run the body for args its
        // key does not name. Copied once per entry made, never per reach that joins one.
        const args = heldArgs(normal)
        // 11.27's VALIDATE, ONCE PER ENTRY AND BEFORE IT IS FILED: a refused `Args` is answered by a
        // value holding the refusal (2.2) that no map keeps, so args nobody should have sent never
        // take a place among the entries — on a `global` value, a place nothing but `invalidate`
        // would take back (11.35). Built with none of the options: a `store` would restore a value
        // over the refusal and watch for an entry nothing releases.
        let run: (args: Args) => unknown = entryBody
        if (gate !== undefined) {
            let accepted: Args
            try {
                accepted = checkArgs(gate, args)
            } catch (refusal) {
                return createReactive<Stored, Accepted, Failures>(
                    `${label}(${key})`,
                    () => {
                        throw refusal
                    },
                    args,
                    undefined,
                    undefined,
                )
            }
            run = handed(entryBody, accepted)
        }
        const created = createReactive<Stored, Accepted, Failures>(
            `${label}(${key})`,
            run as (args: unknown) => unknown,
            args,
            undefined,
            entryOptions as CellOptions<Accepted, Stored, Failures>,
            starts !== null,
            true,
        )
        entries.set(key, created)
        if (lifetime !== null)
            lifetime.follow(key, created as unknown as HoldsCell, () => {
                release(key, created)
            })
        if (starts !== null)
            starts.reached(created, () => {
                // 5.19: superseded before it started — not held, so a later reach starts afresh.
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
        // 13.18 — ALL, as `ready` asks: one entry written here is one the server has not seen.
        synced: (pattern?: Partial<Args>): boolean => {
            askMembership()
            for (const entry of entries.values())
                if (matchesPattern(argsOf(entry), pattern) && !entry.synced())
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
