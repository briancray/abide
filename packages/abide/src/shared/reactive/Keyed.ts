// The keyed face. One entry per `Args` key (RULEBOOK 11.4), computed when that key is
// REACHED rather than on every read — 1.7 puts the start at the reach, and 1.8 has a
// second reach join the standing work rather than start a second.
//
// The static members are the probes and triggers narrowed to matching entries. The
// allocate/do-not-allocate split is carried by the SPELLING: `keyed(args)` reaches an
// entry and starts it, `keyed.busy(pattern)` reads the map and allocates nothing.

import type { Failed } from '../Failed.ts'
import { validationError } from '../refuse.ts'
import { type Found, runSchema, type Schema } from '../Schema.ts'
import { CELL } from './CELL.ts'
import { canonicalKey } from './canonicalKey.ts'
import { armTimer } from './Expiry.ts'
import { NotLanded } from './NotLanded.ts'
import {
    createReactive,
    isStreamBody,
    type Reactive,
    type ReactiveOptions,
    abandonDeferred,
    startDeferred,
    untag,
} from './Reactive.ts'
import {
    CLEAN,
    detach,
    dropReader,
    type Subscriber,
    TRACKING,
    type Tracked,
} from './tracking.ts'

// The argument is optional where `Args` admits `undefined`, so a keyed value whose args may be absent
// is reached as `presence()`.
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
    // The entries reached so far. Not app surface — the statics and the tests read it.
    entries: Map<string, Reactive<Stored, Accepted, Failures>>
}

function matches(args: unknown, pattern: unknown): boolean {
    if (pattern === undefined) return true
    if (args === null || typeof args !== 'object') return args === pattern
    const wanted = pattern as Record<string, unknown>
    const held = args as Record<string, unknown>
    for (const key of Object.keys(wanted))
        if (held[key] !== wanted[key]) return false
    return true
}

// THE LIFE OF EVERY ENTRY OF ONE `Keyed` (11.46, 11.49, 11.50), allocated only where a
// `ttl` was declared.
//
// RECENCY IS THE ORDER OF A MAP. A production moves its key to the end by deleting and
// re-setting it, so the oldest entry is always the first one and 11.49's "armed at the
// oldest" is one iterator step rather than a scan — and the sweep stops at the first entry
// still inside its life, the way `dropExpired` stops at the first live production.
//
// THE PRODUCTION IS HEARD BY A MIRROR ON EACH ENTRY, which is what the refusal that stood
// here said could not be had without a hook on every cell in the design. A mirror is a
// reader, so only an entry of a keyed value declaring `ttl` pays for one, and it runs in the
// mark walk rather than at the end of the turn — so the clock read is the production's own
// moment. It is also woken by a cascade that is not a production (an `invalidate`, an
// abort), and `servable` is what tells those apart: every one of them leaves nothing to
// serve, where a production always leaves something.
class Lifetime {
    ms: number
    lastProduced: Map<string, number>
    followers: Map<
        string,
        { cell: Tracked; reader: Subscriber; evict: () => void }
    >
    timer: ReturnType<typeof setTimeout> | null

    constructor(ms: number) {
        this.ms = ms
        this.lastProduced = new Map()
        this.followers = new Map()
        this.timer = null
    }

    follow(key: string, entry: { [CELL]: Tracked }, evict: () => void): void {
        // 11.33: `Infinity` is the life of the scope, which no timer here can reach.
        if (this.ms === Number.POSITIVE_INFINITY) return
        const cell = entry[CELL]
        const reader: Subscriber = {
            sources: [cell],
            probeSources: [],
            cursor: 0,
            diverged: false,
            alive: true,
            state: CLEAN,
            running: false,
            isEffect: true,
            isMirror: true,
            adopter: null,
            notify: (): void => {
                if ((cell as unknown as { servable: boolean }).servable)
                    this.touch(key)
            },
        }
        cell.readers.push(reader)
        this.followers.set(key, { cell, reader, evict })
        // The life starts at the reach: an entry whose load never lands still ends.
        this.touch(key)
    }

    touch(key: string): void {
        this.lastProduced.delete(key)
        this.lastProduced.set(key, Date.now())
        // THE STANDING TIMER IS LEFT WHERE IT IS. It is armed at an entry at least as old as
        // this one, so it fires no later than anything this touch could need — at worst
        // early, and an early fire evicts nothing and re-arms. Re-arming here would be a
        // `setTimeout` per production.
        if (this.timer === null) this.arm()
    }

    arm(): void {
        for (const oldest of this.lastProduced.values()) {
            armTimer(this, oldest + this.ms - Date.now(), () => {
                this.sweep()
            })
            return
        }
    }

    sweep(): void {
        this.timer = null
        const deadline = Date.now() - this.ms
        for (const [key, at] of this.lastProduced) {
            if (at > deadline) break
            this.lastProduced.delete(key)
            const follower = this.followers.get(key)
            if (follower === undefined) continue
            this.followers.delete(key)
            follower.reader.alive = false
            dropReader(follower.cell, follower.reader)
            follower.evict()
        }
        this.arm()
    }
}

// ONE WINDOW FOR THE WHOLE KEYED FACE (5.20, 5.21, 5.22), holding back starting the entries it reaches.
// A throttle starts the first key at once and the latest reached inside its window when it ends; a
// debounce starts the latest once the reaches stop. Either way only the LATEST held key starts — one
// reached and then superseded inside a window is work the window would discard (5.12), so it is
// abandoned and dropped instead.
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
            // A throttle's window reopens behind what it just started, as a value's does (5.13).
            if (this.leading) this.open()
        })
    }
}

// 11.27's LAST TWO STEPS, validate then the body, as one body. The gate runs on every run of
// the entry — a refresh re-validates — and throws the refusal, which is what a body failing
// already does: the entry's `error` holds it and its read throws it (2.2), and the body the
// gate stands in front of is never called.
//
// A STREAM STAYS A STREAM. 9.20 reads the body's KIND, so the wrapper around an async generator
// is an async generator, or gating a keyed stream would silently make it a value holding one.
function gated<Args>(
    body: (args: Args) => unknown,
    gate: Schema<Args>,
): (args: Args) => unknown {
    const check = (args: Args): void => {
        const answer = runSchema(gate, args)
        if (answer.issues !== null) throw validationError<Found>(answer.issues)
    }
    if (isStreamBody(body))
        return async function* (args: Args) {
            check(args)
            yield* (body as (args: Args) => AsyncIterable<unknown>)(args)
        }
    return (args: Args): unknown => {
        check(args)
        return body(args)
    }
}

// 14.4, 11.6 AND 11.23: AN ENTRY KEEPS NOTHING IT READ past a run that completed, so a value
// its body read changing neither recomputes it nor makes it busy — `ttl`, a trigger and
// eviction are its only ways back. The run still TRACKS, and has to: a body aborted on a value
// that has not landed is brought back by the subscription its read made (2.14), so an abort is
// the one exit that keeps what it read.
//
// HERE RATHER THAN IN `run`. A test in `run` is paid by every recompute of every unkeyed value
// in the graph, and measured at 6-9% on a chain of twenty under V8 for a case no unkeyed value
// reaches; wrapping the entry's body is paid by an entry's run alone. The run has set the
// entry as the reader by the time this is called, so dropping its sources here leaves `run`
// finding nothing past its cursor to trim.
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

export function createKeyed<
    Stored,
    Args,
    Accepted,
    Failures extends Failed<string, unknown>,
>(
    label: string,
    body: (args: Args) => unknown,
    options: ReactiveOptions<Accepted, Stored, never, Args> | undefined,
): Keyed<Stored, Args, Accepted, Failures> {
    const entries = new Map<string, Reactive<Stored, Accepted, Failures>>()
    // What each entry was keyed on, so a pattern can be matched without re-parsing the
    // canonical form back into an object.
    const keyedOn = new Map<string, Args>()
    // 11.46: A KEYED `ttl` IS THE LIFE OF AN ENTRY, not of a production inside one, so it is
    // taken off the options every entry is built from — forwarded, it would build the
    // unkeyed mechanism in every entry and evict nothing from this map.
    const { ttl, args: gate, throttle, debounce, ...rest } = options ?? {}
    // 9.28: `history` is among what every entry is built from, so each entry keeps its own.
    const entryOptions = rest
    // 5.15, at the factory: a keyed value is capped one way or the other.
    if (throttle !== undefined && debounce !== undefined)
        throw new Error(
            `${label}() declares both throttle and debounce. A value is capped one way or the other.`,
        )
    // 5.20: A KEYED VALUE'S WINDOW HOLDS BACK STARTING A KEY, rather than capping each entry's wakes.
    const starts =
        throttle === undefined && debounce === undefined
            ? null
            : new StartWindow(throttle !== undefined, (throttle ?? debounce) as number)
    const lifetime = ttl === undefined ? null : new Lifetime(ttl)
    const entryBody = heldOnce(
        gate === undefined ? body : gated(body, gate as Schema<Args>),
    )

    function hold(
        key: string,
        args: Args,
        created: Reactive<Stored, Accepted, Failures>,
    ): void {
        entries.set(key, created)
        keyedOn.set(key, args)
        if (lifetime !== null)
            lifetime.follow(
                key,
                created as unknown as { [CELL]: Tracked },
                () => {
                    entries.delete(key)
                    keyedOn.delete(key)
                    untag(created)
                },
            )
    }

    const self = function reach(
        args: Args,
    ): Reactive<Stored, Accepted, Failures> {
        const key = canonicalKey(args)
        const standing = entries.get(key)
        // 1.8: reaching an instance that exists joins the standing work.
        if (standing !== undefined) return standing
        const created = createReactive<Stored, Accepted, Failures>(
            `${label}(${key})`,
            entryBody as (args: unknown) => unknown,
            args,
            undefined,
            entryOptions as ReactiveOptions<Accepted, Stored, Failures>,
            starts !== null,
        )
        hold(key, args, created)
        if (starts !== null)
            starts.reached(created, () => {
                // 5.21: superseded before it started — not held, so a later reach starts afresh.
                if (entries.get(key) !== created) return
                entries.delete(key)
                keyedOn.delete(key)
                untag(created)
            })
        return created
    } as Keyed<Stored, Args, Accepted, Failures>

    self.entries = entries
    self.busy = (pattern?: Partial<Args>): boolean => {
        for (const [key, entry] of entries)
            if (matches(keyedOn.get(key), pattern) && entry.busy()) return true
        return false
    }
    // ALL rather than ANY, and the quantifiers are not a pair of preferences: `busy`
    // asks whether anything is loading, `ready` whether everything is servable, and
    // that is the only pairing under which `busy && !ready` reads as one sentence.
    self.ready = (pattern?: Partial<Args>): boolean => {
        for (const [key, entry] of entries)
            if (matches(keyedOn.get(key), pattern) && !entry.ready())
                return false
        return true
    }
    self.refresh = (pattern?: Partial<Args>): void => {
        for (const [key, entry] of entries)
            if (matches(keyedOn.get(key), pattern)) entry.refresh()
    }
    self.invalidate = (pattern?: Partial<Args>): void => {
        for (const [key, entry] of entries)
            if (matches(keyedOn.get(key), pattern)) entry.invalidate()
    }
    return self
}
