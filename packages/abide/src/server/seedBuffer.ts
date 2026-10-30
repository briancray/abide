// 41.5, 41.7 AND 41.13 — THE SEED BUFFER. A page's render calls its handlers in process; the page then
// hydrates in a browser, re-executes its setup (41.6), and makes the same calls over the wire. Each
// of those is answered from the value the render reached rather than by running the handler again
// — the value itself, so a call arriving while the render's load is still in flight joins it.
//
// KEYED BY WHO, WHAT AND WITH WHICH ARGS (41.18): the caller's cookie, the one thing the browser's
// call carries that the render also saw, and the handler and the `Args` key 11.24 takes. A GET's
// query arrives as text until 19.7 coerces it, so a render that passed a number misses here and
// the handler runs — the answer is right and the saving is lost.
//
// ONE CALL PER ENTRY (41.16), and a bounded life for the entries nothing takes (41.17): a page read
// with scripting off, or by a crawler, fills entries no call will ever come for.
//
// 16.33 — A STREAM'S TRANSCRIPT IS THE VALUE'S OWN ACCUMULATION, held as chunks and framed when the
// entry is taken, so it is one transcript whichever framing the call asks for. Where
// `ABIDE_MAX_STREAM_BUFFER_SIZE` bounds it, the bytes are counted in the chunk type's default framing
// as the chunks land, and an entry past the bound stops holding the stream — its call is then one the
// buffer cannot answer.
//
// 41.12 — A CALL THE BUFFER CANNOT ANSWER RUNS THE HANDLER, AND WARNS on `abide:hydrate` where the
// buffer can tell the call was its to answer: an entry left for other args of the same handler, one
// past its life, or one past the transcript bound. A call for args an entry already answered is a
// refresh, and says nothing.

import { namedLogger } from '#shared/log.ts'
import { canonicalKey } from '#shared/reactive/canonicalKey.ts'
import {
    chunksOfStream,
    isReactive,
    STREAMING,
    streamingOrSettled,
} from '#shared/reactive/index.ts'

import { positiveSetting } from './config.ts'
import {
    currentRequestScope,
    heldByApp,
    type PageRender,
    releaseScope,
} from './requestScope.ts'

const HYDRATE_LOG = namedLogger('abide:hydrate')

const ENCODER = new TextEncoder()

const NOTHING_HELD = (): void => {}

// 41.17.
const SEED_LIFE_MS = 30_000

/**
 * How a handler's call ended, and how long it took from the call to the end.
 *
 * What 21.15's `server-timing` reports, whichever call it was that ran it. A stream has no end to
 * time by then, and its `undefined` is timed where its first chunk is answered.
 */
export type Outcome =
    | { settled: true; value: unknown; duration: number | undefined }
    | { settled: false; error: unknown; duration: number }

type Entry = {
    rpc: object
    key: string
    // `undefined` once a stream's transcript passed `ABIDE_MAX_STREAM_BUFFER_SIZE` (16.33).
    outcome: Promise<Outcome> | undefined
    expires: number
    // Cleared when the entry is taken, so an answered entry's value is not held for the rest of its life.
    timer: ReturnType<typeof setTimeout> | undefined
    // Stops counting a stream's transcript against its bound.
    release: () => void
    // 42.11 — unfiles the entry from the app whose render left it, which drops it when it stops.
    unhold: () => void
    // 41.13 — lets the render's scope go, which the entry holds while what it reached is in flight.
    letGo: () => void
    // Whether a call took it, which then answers from what the render reached until that settles.
    taken: boolean
}

// INDEXED BY THE THREE THINGS 41.18 MATCHES ON — caller, handler, args key — so a call finds its entry
// without reading the others. A caller whose calls never match (a crawler, a render whose args the
// wire does not reproduce) leaves every entry standing for 30 seconds, and a list read end to end
// made each of its calls pay for all of them. Several entries under one key are taken oldest first,
// and a key whose entries are all taken keeps its empty list while the handler has others standing,
// which is how a refresh of it is told from a call the render never made (41.12).
const BUFFER = new Map<string, Map<object, Map<string, Entry[]>>>()

/** A render's one report of each call (1.8): the call's key where it is new, `undefined` where not. */
function reportsOnce(): (rpc: object, args: unknown) => string | undefined {
    const reported = new Map<object, Set<string>>()
    return (rpc, args) => {
        const key = seedKey(args)
        if (key === undefined) return undefined
        let keys = reported.get(rpc)
        if (keys === undefined) {
            keys = new Set()
            reported.set(rpc, keys)
        }
        if (keys.has(key)) return undefined
        keys.add(key)
        return key
    }
}

/**
 * 41.30 — the seed sink of a page the worker keeps: each call reported once, for the early-call
 * script, and none of them left in the seed buffer (41.29) — the page is opened later, if at all.
 */
export function callsOnly(): PageRender['seed'] {
    const firstReport = reportsOnce()
    return (rpc, args) => firstReport(rpc, args) !== undefined
}

/**
 * The sink a page's render scope reports each call into, for one caller.
 *
 * The sink answers `true` where the call was new to this render. A key already reported is
 * reported once: two components reaching one invoice are one call in the browser too, since the
 * browser's `Rpc` joins a standing call (1.8).
 */
export function seedFor(caller: string): PageRender['seed'] {
    const firstReport = reportsOnce()
    return (rpc, args, reached) => {
        const key = firstReport(rpc, args)
        if (key === undefined) return false
        const entry: Entry = {
            rpc,
            key,
            // 1.4 — the `Reactive` is thenable, and this is its settling: the production the render
            // had, or the one it is still waiting on.
            outcome: outcomeOf(reached),
            expires: Date.now() + SEED_LIFE_MS,
            timer: undefined,
            release: NOTHING_HELD,
            unhold: NOTHING_HELD,
            letGo: NOTHING_HELD,
            taken: false,
        }
        // 41.13 — THE RENDER'S SCOPE IS HELD WHILE WHAT IT REACHED IS IN FLIGHT: the page is answered
        // before a slow value lands, and letting the scope go stops that value's run — a stream the
        // browser's call would join then never closes. Let go once it settles, a stream at its close.
        const scope = currentRequestScope()
        if (scope !== undefined && isReactive(reached)) {
            scope.holds += 1
            let held = true
            entry.letGo = () => {
                if (!held) return
                held = false
                releaseScope(scope)
            }
            Promise.resolve(reached).then(entry.letGo, entry.letGo)
        }
        const bound = positiveSetting(
            'ABIDE_MAX_STREAM_BUFFER_SIZE',
            Number.POSITIVE_INFINITY,
        )
        if (Number.isFinite(bound) && isReactive(reached))
            entry.release = boundTranscript(reached, bound, () => {
                entry.outcome = undefined
                entry.release = NOTHING_HELD
            })
        let byRpc = BUFFER.get(caller)
        if (byRpc === undefined) {
            byRpc = new Map()
            BUFFER.set(caller, byRpc)
        }
        let byKey = byRpc.get(rpc)
        if (byKey === undefined) {
            byKey = new Map()
            byRpc.set(rpc, byKey)
        }
        let entries = byKey.get(key)
        if (entries === undefined) {
            entries = []
            byKey.set(key, entries)
        }
        entries.push(entry)
        entry.unhold = heldByApp(() => drop(caller, entry))
        // UNREF'D, so a process with nothing else to do is not kept up by entries nobody will take.
        entry.timer = setTimeout(
            () => drop(caller, entry),
            SEED_LIFE_MS,
        ).unref()
        return true
    }
}

/**
 * Counts a stream's transcript as it lands; calls `over` once it passes `bound` bytes.
 *
 * 16.33 — IN THE CHUNK TYPE'S DEFAULT FRAMING: a binary chunk's bytes, a value's jsonl line. Read
 * through the reader an answer uses, so nothing is copied to count it. Returns what stops counting.
 */
function boundTranscript(
    reached: unknown,
    bound: number,
    over: () => void,
): () => void {
    let counting = true
    void (async () => {
        let bytes = 0
        try {
            // 9.6 — a value may only turn out to stream once its load resolves.
            const settled = await streamingOrSettled(reached)
            if (!counting || settled !== STREAMING) return
            for await (const chunk of chunksOfStream(reached)) {
                if (!counting) return
                bytes +=
                    chunk instanceof Uint8Array
                        ? chunk.byteLength
                        : ENCODER.encode(`${JSON.stringify(chunk)}\n`)
                              .byteLength
                if (bytes > bound) {
                    over()
                    return
                }
            }
        } catch {
            // A stream that failed is answered as it failed, by whichever call takes the entry.
        }
    })()
    return () => {
        counting = false
    }
}

/**
 * Takes the outcome this caller's render left for this handler and these args, or `undefined`.
 *
 * `undefined` where there is none, it has been taken, its life is over, or its transcript passed
 * its bound. The args are keyed only once the caller is known to have entries for this handler,
 * which a call from a page that was not rendered for it never does.
 */
export function takeSeed(
    caller: string,
    rpc: object,
    args: unknown,
): Promise<Outcome> | undefined {
    const byKey = BUFFER.get(caller)?.get(rpc)
    if (byKey === undefined) return undefined
    const key = seedKey(args)
    if (key === undefined) return undefined
    const entries = byKey.get(key)
    if (entries === undefined) {
        const standing: string[] = []
        for (const [other, left] of byKey)
            if (left.length > 0) standing.push(other)
        missed(
            rpc,
            key,
            `the render made it with other args: ${standing.join(', ')}`,
        )
        return undefined
    }
    const entry = entries[0]
    if (entry === undefined) return undefined
    entry.taken = true
    // And no longer than the call that took it: a stream that never closes ends with its reader.
    currentRequestScope()?.stops.push(entry.letGo)
    drop(caller, entry)
    // READ AS WELL AS SWEPT: a timer can fire late, and an entry past its life answers nothing.
    if (entry.expires <= Date.now()) {
        missed(
            rpc,
            key,
            `its entry outlived its ${SEED_LIFE_MS / 1000} seconds`,
        )
        return undefined
    }
    if (entry.outcome === undefined)
        missed(rpc, key, 'its transcript passed ABIDE_MAX_STREAM_BUFFER_SIZE')
    return entry.outcome
}

/** 41.12 — the warning a call the buffer was expected to answer, and did not, is logged with. */
function missed(rpc: object, key: string, why: string): void {
    const address = (rpc as { address?: string }).address ?? 'a handler'
    HYDRATE_LOG.warning(
        `the call to ${address} with args ${key} was not answered from the seed buffer, because ${why}, so the handler ran again. RULEBOOK 41.12.`,
    )
}

/** 11.24's key, or `undefined` where 11.64 refuses the args — which the call itself then says. */
function seedKey(args: unknown): string | undefined {
    try {
        return canonicalKey(args)
    } catch {
        return undefined
    }
}

function drop(caller: string, entry: Entry): void {
    clearTimeout(entry.timer)
    entry.release()
    entry.unhold()
    // Nothing will answer from an entry no call took, so its run need not finish.
    if (!entry.taken) entry.letGo()
    const byRpc = BUFFER.get(caller)
    const byKey = byRpc?.get(entry.rpc)
    const entries = byKey?.get(entry.key)
    if (byRpc === undefined || byKey === undefined || entries === undefined)
        return
    const at = entries.indexOf(entry)
    if (at !== -1) entries.splice(at, 1)
    for (const left of byKey.values()) if (left.length > 0) return
    byRpc.delete(entry.rpc)
    if (byRpc.size === 0) BUFFER.delete(caller)
}

/**
 * How a call's reached value settles, timed from here.
 *
 * 1.4 — a call's `Reactive` is thenable, and this is its settling. 1.6 — A STREAMING one is read by
 * its brand first and answered as its chunks, which `answerValue` frames as they land: settling it
 * would be one snapshot, once the run had closed.
 */
export function outcomeOf(reached: unknown): Promise<Outcome> {
    const started = performance.now()
    // 9.6 — AND ONE THAT TURNS INTO A STREAM when its load resolves to a generator, as a handler
    // behind rungs does: waited for as far as the turn, and never out to the run's close.
    return (
        isReactive(reached)
            ? streamingOrSettled(reached)
            : Promise.resolve(reached)
    ).then(
        (value): Outcome =>
            value === STREAMING
                ? {
                      settled: true,
                      value: chunksOfStream(reached),
                      duration: undefined,
                  }
                : {
                      settled: true,
                      value,
                      duration: performance.now() - started,
                  },
        (error: unknown): Outcome => ({
            settled: false,
            error,
            duration: performance.now() - started,
        }),
    )
}
