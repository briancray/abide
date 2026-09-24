// 41.5, 41.7 AND 41.13 — THE SEED BUFFER. A page's render calls its handlers in process; the page then
// hydrates in a browser, re-executes its setup (41.6), and makes the same calls over the wire. Each
// of those is answered from the value the render reached rather than by running the handler again
// — the value itself, so a call arriving while the render's load is still in flight joins it.
//
// KEYED BY WHO, WHAT AND WITH WHICH ARGS (41.19): the caller's cookie, the one thing the browser's
// call carries that the render also saw, and the handler and the `Args` key 11.24 takes. A GET's
// query arrives as text until 19.8 coerces it, so a render that passed a number misses here and
// the handler runs — the answer is right and the saving is lost.
//
// ONE CALL PER ENTRY (41.17), and a bounded life for the entries nothing takes (41.18): a page read
// with scripting off, or by a crawler, fills entries no call will ever come for.

import { canonicalKey } from '#shared/reactive/canonicalKey.ts'
import { chunksOfStream, isStreaming } from './answerValue.ts'

// 41.18.
const SEED_LIFE_MS = 30_000

// How a handler's call ended, and how long it took from the call to the end — what 21.15's
// `server-timing` reports, whichever call it was that ran it. A stream has no end to time by
// then, and its `undefined` is timed where its first chunk is answered.
export type Outcome =
    | { settled: true; value: unknown; duration: number | undefined }
    | { settled: false; error: unknown; duration: number }

type Entry = {
    rpc: object
    key: string
    outcome: Promise<Outcome>
    expires: number
    // Cleared when the entry is taken, so an answered entry's value is not held for the rest of its life.
    timer: ReturnType<typeof setTimeout> | undefined
}

// INDEXED BY THE THREE THINGS 41.19 MATCHES ON — caller, handler, args key — so a call finds its entry
// without reading the others. A caller whose calls never match (a crawler, a render whose args the
// wire does not reproduce) leaves every entry standing for 30 seconds, and a list read end to end
// made each of its calls pay for all of them. Several entries under one key are taken oldest first.
const BUFFER = new Map<string, Map<object, Map<string, Entry[]>>>()

// The sink a page's render scope reports each call into, for one caller — `true` where the call was
// new to this render. A key already reported is reported once: two components reaching one invoice
// are one call in the browser too, since the browser's `Rpc` joins a standing call (1.8).
export function seedFor(
    caller: string,
): (rpc: object, args: unknown, reached: unknown) => boolean {
    const reported = new Map<object, Set<string>>()
    return (rpc, args, reached) => {
        const key = seedKey(args)
        if (key === undefined) return false
        let keys = reported.get(rpc)
        if (keys === undefined) {
            keys = new Set()
            reported.set(rpc, keys)
        }
        if (keys.has(key)) return false
        keys.add(key)
        const entry: Entry = {
            rpc,
            key,
            // 1.4 — the `Reactive` is thenable, and this is its settling: the production the render
            // had, or the one it is still waiting on.
            outcome: outcomeOf(reached),
            expires: Date.now() + SEED_LIFE_MS,
            timer: undefined,
        }
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
        // UNREF'D, so a process with nothing else to do is not kept up by entries nobody will take.
        entry.timer = setTimeout(
            () => drop(caller, entry),
            SEED_LIFE_MS,
        ).unref()
        return true
    }
}

// The entry this caller's render left for this handler and these args, taken out of the buffer —
// or `undefined`, where there is none, it has been taken, or its life is over. The args are keyed
// only once the caller is known to have entries for this handler, which a call from a page that
// was not rendered for it never does.
export function takeSeed(
    caller: string,
    rpc: object,
    args: unknown,
): Promise<Outcome> | undefined {
    const byKey = BUFFER.get(caller)?.get(rpc)
    if (byKey === undefined) return undefined
    const key = seedKey(args)
    if (key === undefined) return undefined
    const entry = byKey.get(key)?.[0]
    if (entry === undefined) return undefined
    drop(caller, entry)
    // READ AS WELL AS SWEPT: a timer can fire late, and an entry past its life answers nothing.
    return entry.expires > Date.now() ? entry.outcome : undefined
}

// 11.24's key, or `undefined` where 11.65 refuses the args — which the call itself then says.
function seedKey(args: unknown): string | undefined {
    try {
        return canonicalKey(args)
    } catch {
        return undefined
    }
}

function drop(caller: string, entry: Entry): void {
    clearTimeout(entry.timer)
    const byRpc = BUFFER.get(caller)
    const byKey = byRpc?.get(entry.rpc)
    const entries = byKey?.get(entry.key)
    if (entries === undefined) return
    const at = entries.indexOf(entry)
    if (at !== -1) entries.splice(at, 1)
    if (entries.length > 0) return
    byKey?.delete(entry.key)
    if (byKey?.size !== 0) return
    byRpc?.delete(entry.rpc)
    if (byRpc?.size === 0) BUFFER.delete(caller)
}

// 1.4 — a call's `Reactive` is thenable, and this is its settling, timed from here. 1.6 — A STREAMING
// one is read by its brand first and answered as its chunks, which `answerValue` frames as they land:
// settling it would be one snapshot, once the run had closed.
export function outcomeOf(reached: unknown): Promise<Outcome> {
    const started = performance.now()
    if (isStreaming(reached))
        return Promise.resolve({
            settled: true,
            value: chunksOfStream(reached),
            duration: undefined,
        })
    return Promise.resolve(reached).then(
        (value): Outcome => ({
            settled: true,
            value,
            duration: performance.now() - started,
        }),
        (error: unknown): Outcome => ({
            settled: false,
            error,
            duration: performance.now() - started,
        }),
    )
}
