// A CALL REACHING A LOAD, and what the calls waiting on it decide about it: who may end it (16.48),
// how long it may go without its answer or first chunk (16.59), and whether the call after an ended one starts
// another (16.62, 15.19). The policy the core's load primitives — `loadOf`, `abandonLoad`,
// `streamingOrSettled` — are spent on, kept beside them rather than inside `Reactive.ts`: the core
// is in every page's static closure, and only a page holding a handler calls a load.
//
// ONE RECORD PER VALUE, IN A SIDE TABLE, not a field on the cell. Every value would carry the field
// and only a called one ever fills it, so the table is what keeps a plain `reactive` paying nothing.

import { beginLoadCall, endLoadCall, reachedInLoadCall } from '../loadCall.ts'
import { refuse } from '../refuse.ts'
import { armTimer } from './armTimer.ts'
import { type Cell, cellOf } from './cellShape.ts'
// Through the barrel first, for the cycle it names: rpc reaches this module ahead of the barrel.
import { isReactive, STREAMING } from './index.ts'
import {
    abandonLoad,
    failedTransiently,
    loadOf,
    streamingOrSettled,
} from './producer.ts'

/**
 * Who is waiting on one value's load, and what the last one came to.
 *
 * 16.48 — WHO IS WAITING ON A LOAD. Calls with the same args join one load (1.8), so one caller's
 * signal is not the load's to end: a call with no signal pins it, and a load no call pinned ends
 * once every signal handed to it has aborted. Replaced per load, so a refresh starts the count
 * again — and kept past an abort, which is what 16.62 reads.
 *
 * The abort LISTENER is the record itself (`handleEvent`), so a load is one record and no
 * closure over the call that started it. `declare`d fields, every one set in the constructor in one
 * order, so the shape is fixed there and the bundle carries no field list.
 */
class Attended {
    declare value: object
    declare load: number
    declare pinned: boolean
    declare signals: Set<AbortSignal> | null
    declare ending: AbortController | undefined
    /** 16.61 — whether this load's clock is running, so a join starts none. */
    declare timed: boolean
    /** 16.62 — whether 16.48 ended this load, until a call reaches the value again. */
    declare abandoned: boolean

    constructor(
        value: object,
        load: number,
        ending: AbortController | undefined,
    ) {
        this.value = value
        this.load = load
        this.pinned = false
        this.signals = null
        this.ending = ending
        this.timed = false
        this.abandoned = false
    }

    handleEvent(): void {
        const value = this.value
        if (ATTENDED.get(value) !== this || loadOf(value) !== this.load) return
        if (this.pinned) return
        for (const each of this.signals as Set<AbortSignal>)
            if (!each.aborted) return
        this.ending?.abort()
        abandonLoad(value, refuse.aborted())
        this.abandoned = true
    }
}

const ATTENDED = new WeakMap<object, Attended>()

/** 15.19 — the run each value stood at as the last call to reach it left it. */
const LEFT_AT = new WeakMap<Cell, number>()

/**
 * Reaches `args` through `reach` as a call does, under that call's `signal` and `timeout`.
 *
 * 16.49 — a load this call starts may be ended by it, so its transport is handed a signal of the
 * load's own (`startingLoadCall`, read by the body as it starts) — the caller's is only one vote.
 */
export function callLoad(
    reach: (args: unknown) => unknown,
    args: unknown,
    signal: AbortSignal | undefined,
    timeout: number | undefined,
    // 16.81 — read by a browser's wire as its body starts, and by nothing on a server (16.84).
    offline?: (args: unknown) => unknown,
): unknown {
    const ending = signal === undefined ? undefined : new AbortController()
    beginLoadCall(ending?.signal, offline)
    let reached: unknown
    let attended: Attended | undefined
    try {
        reached = reach(args)
        reachedInLoadCall(reached)
        attended = ATTENDED.get(reached as object)
        // 16.62 — the callers of an aborted load stopped waiting, and this one has not.
        // 15.19 — and of one whose last answer failed transiently, which runs again here where an
        // unkeyed handler has no reach of its own to run it: a failure some call before this one
        // was handed. One this reach's own run produced — a fresh value's first run, a `Keyed`
        // entry its reach already ran again — is this call's answer, and running it again here ran
        // a body that refuses synchronously twice per call.
        let again = false
        if (attended?.abandoned) {
            attended.abandoned = false
            again = loadOf(reached) === undefined
        }
        // Keyed by the cell: an unkeyed handler's forwarder is one for every request's instance.
        const cell = isReactive(reached) ? cellOf(reached) : undefined
        if (
            again ||
            (cell !== undefined &&
                LEFT_AT.get(cell) === cell.generation &&
                failedTransiently(reached))
        )
            (reached as { refresh(): void }).refresh()
        if (cell !== undefined) LEFT_AT.set(cell, cell.generation)
    } finally {
        endLoadCall()
    }
    if (!isReactive(reached)) return reached
    const load = loadOf(reached)
    // Landed as it was reached, or nothing in flight: there is no load to end or to time.
    if (load === undefined) return reached
    if (attended === undefined || attended.load !== load) {
        // The first call to reach this load is the one that started it, where one started it at
        // all — a refresh starts a load no call handed a signal to, and `ending` is then inert.
        attended = new Attended(reached, load, ending)
        ATTENDED.set(reached, attended)
    }
    attend(attended, signal)
    if (!attended.timed) timeLoad(attended, timeout)
    return reached
}

/** Files a call's signal, or its pin, against the load it reached (16.48). */
function attend(attended: Attended, signal: AbortSignal | undefined): void {
    if (signal === undefined) {
        attended.pinned = true
        return
    }
    let signals = attended.signals
    if (signals === null) {
        signals = new Set()
        attended.signals = signals
        // A SIGNAL OUTLIVES THE LOADS HANDED IT — a page's own controller — so its listener goes
        // when the load settles, or it pins every value it was ever handed until it aborts.
        const forget = (): void => {
            for (const each of signals as Set<AbortSignal>)
                each.removeEventListener('abort', attended)
        }
        void Promise.resolve(attended.value).then(forget, forget)
    } else if (signals.has(signal)) return
    signals.add(signal)
    if (signal.aborted) attended.handleEvent()
    else signal.addEventListener('abort', attended, { once: true })
}

/**
 * Ends a load that goes `milliseconds` without its answer or its first chunk, refusing it 504.
 *
 * 16.12, 16.58, 16.59 — `timeout` ON EVERY CALL: a load that goes that long without settling, or a
 * stream without its first chunk, is ended where it stands, as 16.49 ends one, and refuses 504. A
 * STREAM THAT HAS BEGUN KEEPS ITS OWN PACE: a chat, a ticker or a ledger's tail waits on what has
 * not happened yet, and timing the gap between chunks ended every quiet feed — `ABIDE_RPC_TIMEOUT`
 * set app-wide ended all of them at once.
 * ONE CLOCK PER LOAD: a call joining a load (1.8) is not a reason to give it longer, and the first
 * clock would end the load at its own time whatever a second one did — so a join starts none.
 */
function timeLoad(attended: Attended, milliseconds: number | undefined): void {
    if (milliseconds === undefined || !Number.isFinite(milliseconds)) return
    attended.timed = true
    const reached = attended.value
    const load = attended.load
    // `armTimer`'s, so the clock is capped at what `setTimeout` holds and never holds the process open.
    const clock: { timer: ReturnType<typeof setTimeout> | null } = {
        timer: null,
    }
    const expire = (): void => {
        if (loadOf(reached) === load) abandonLoad(reached, refuse(504))
    }
    const end = (): void => {
        if (clock.timer !== null) clearTimeout(clock.timer)
    }
    // The first chunk ends the clock, as does the run's close (2.6). What the run failed with is the
    // load's to answer, so the wait only stops on it.
    const firstChunk = async (): Promise<void> => {
        try {
            for await (const _ of reached as AsyncIterable<unknown>) break
        } catch {}
        end()
    }
    armTimer(clock, milliseconds, expire)
    // 9.6 — a value behind rungs only turns out to stream once the onion resolves, so the question
    // is asked then, by the one wait that also hears a value settle or refuse.
    streamingOrSettled(reached).then((settled) => {
        if (settled !== STREAMING) return end()
        void Promise.resolve(reached).then(end, end)
        if (loadOf(reached) === load) void firstChunk()
    }, end)
}
