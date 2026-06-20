import { createLifecycleChannel } from '../shared/createLifecycleChannel.ts'
import { createSubscriber } from '../shared/createSubscriber.ts'
import { SocketDisconnectedError } from '../shared/SocketDisconnectedError.ts'
import { tailProbeSlot } from '../shared/tailProbeSlot.ts'
import type { Subscribable } from '../shared/types/Subscribable.ts'
import type { TailOptions } from '../shared/types/TailOptions.ts'

type TailStatus = 'pending' | 'open' | 'done' | 'error'

/*
One entry shape for both read forms: the bare latest-wins read is a window of
1 projected to its single frame, so the frame loop, reconnect handling, and
probes have exactly one path. The bare form keys by name alone (so `tail(x)`
and `tail(x, { last: 1 })` stay independent subscriptions); probes match on
`source`.
*/
type Entry<T> = {
    source: string
    key: string
    /* window cap; 1 for the bare latest-wins form */
    last: number
    window: T[]
    error: Error | undefined
    status: TailStatus
    refreshing: boolean
    /* true while the createSubscriber connect callback holds the iterator open */
    live: boolean
    tap: () => void
}

const registry = new Map<string, Entry<unknown>>()

/*
Registry-wide lifecycle channel for the pending()/refreshing() probes — the
tail-side counterpart of the cache store's. Probes match entries by source
name (or all) without creating them, so they tap one "membership or state
changed" signal instead of opening a stream the way a tail() read would.
*/
const lifecycle = createLifecycleChannel()

/*
Prober for the shared pending()/refreshing() probes. Probes report, never
act: an absent entry is read as "no value yet" (pending) without opening a
stream. A name spans every entry on that source — latest-wins and window
forms alike; the bare form spans every registered stream.
*/
tailProbeSlot.probe = (name) => {
    lifecycle.track()
    const entries = [...registry.values()].filter(
        (entry) => name === undefined || entry.source === name,
    )
    return {
        pending:
            (name !== undefined && entries.length === 0) ||
            entries.some((entry) => entry.status === 'pending'),
        refreshing: entries.some((entry) => entry.refreshing),
    }
}

/*
Reactive consumer for streaming sources. Takes a Subscribable<T> — the shape
both `Socket<T>` (declared under src/server/sockets/) and the result of
`fn.stream(args)` satisfy:

  const latest = $derived(tail(chat))                      // socket, latest frame
  const recent = $derived(tail(chat, { last: 20 }))        // live window of the last ≤20
  const tick   = $derived(tail(tickFeed.stream()))         // rpc stream

The bare form is latest-wins: T | undefined, pending until the first frame.
The window form returns T[] — `[]` while pending, never undefined — holding
the last ≤`last` frames however they arrived. Seeding rides the source's
optional retention capability (`Subscribable.tail(count)`): a socket declared
`{ tail: n }` replays up to `last` retained frames (1 for the bare form — a
latest-wins reader only needs the newest); a source without the capability
(rpc stream, undeclared socket) starts live-only. tail() never requires
retention — the window semantics are identical either way, only how much
past it can show differs.

Lifecycle mirrors cache(): the entry's tracker is a createSubscriber,
so the first derived read in a tracking scope opens the underlying iterator
and the last derived to stop reading closes it. Many deriveds reading the
same source share one underlying subscription — the registry dedupes by
`subscribable.name`, with `last` folded into the key, so the bare form and
each window size are independent subscriptions. Passing fresh `fn.stream(args)`
Subscribables across re-renders is safe: same args → same key → shared
subscription. tail.error / tail.status take the same options to address the
same entry.

Reconnect-with-retained-value: a transport loss (the typed
SocketDisconnectedError, raised only by the ws channel — an rpc stream is a
one-shot Response and never disconnects) does not surface as an error. The
entry keeps its window, flags `refreshing` (the probe contract: value held,
fresher source in flight — never merely `open`), and re-invokes the source;
the channel's backoff owns the retry. The reopened source's replay commits
over the window atomically at the `replayed` boundary (TailHooks) — appended
it would duplicate, rebuilt frame-by-frame it would flash — and an empty
replay keeps the held window, with live frames appending after. For the
bare form the commit is exactly latest-wins convergence. Initial opens seed
the same way, so a window's first paint is the full seed, not a staircase.

tail is a no-op on the server (returns undefined / []) — SSR can't keep a
stream open across the request boundary. Pages that want a seeded value in
the initial HTML should fetch via cache() against an HTTP rpc handler and
layer tail() on top for live updates after hydration.

Errors are surfaced through tail.error(x) rather than thrown, so reading
from a $derived can't crash the component. Status distinguishes "haven't
received the first frame" (pending) from "stream ended cleanly" (done) and
"wire layer surfaced an error" (error).
*/
// @documentation tail
export function tail<T>(subscribable: Subscribable<T>): T | undefined
export function tail<T>(subscribable: Subscribable<T>, options: TailOptions): T[]
export function tail<T>(subscribable: Subscribable<T>, options?: TailOptions): T | T[] | undefined {
    if (options) {
        return readField(subscribable, options, 'window') ?? []
    }
    return readField(subscribable, undefined, 'window')?.[0]
}

tail.error = function tailError<T>(
    subscribable: Subscribable<T>,
    options?: TailOptions,
): Error | undefined {
    return readField(subscribable, options, 'error')
}

tail.status = function tailStatus<T>(
    subscribable: Subscribable<T>,
    options?: TailOptions,
): TailStatus {
    return readField(subscribable, options, 'status') ?? 'pending'
}

function readField<T, K extends keyof Entry<T>>(
    subscribable: Subscribable<T>,
    options: TailOptions | undefined,
    field: K,
): Entry<T>[K] | undefined {
    if (options && (!Number.isInteger(options.last) || options.last < 1)) {
        throw new RangeError(`[abide] tail() \`last\` must be an integer ≥ 1, got ${options.last}`)
    }
    if (typeof window === 'undefined') {
        return undefined
    }
    const entry = getOrCreateEntry(subscribable, options)
    entry.tap()
    const value = entry[field]
    /*
    Untracked read (outside $derived/$effect): tap() never connects, so no
    teardown will ever evict the entry — drop it now or it sits in the
    registry as a permanently-pending zombie the bare probes keep seeing.
    */
    if (!entry.live) {
        evictIfCurrent(entry as Entry<unknown>)
    }
    return value
}

/* Delete only if this entry still owns its key — a fresh Subscribable with the
   same name may have replaced it, and a stale cleanup must not nuke the new entry. */
function evictIfCurrent(entry: Entry<unknown>): boolean {
    if (registry.get(entry.key) === entry) {
        registry.delete(entry.key)
        return true
    }
    return false
}

function getOrCreateEntry<T>(
    subscribable: Subscribable<T>,
    options: TailOptions | undefined,
): Entry<T> {
    const key = options ? `${subscribable.name}#${options.last}` : subscribable.name
    const cached = registry.get(key)
    if (cached) {
        return cached as Entry<T>
    }
    const last = options?.last ?? 1
    const entry: Entry<T> = {
        source: subscribable.name,
        key,
        last,
        window: [],
        error: undefined,
        status: 'pending',
        refreshing: false,
        live: false,
        tap: () => undefined,
    }
    entry.tap = createSubscriber((update) => {
        entry.window = []
        entry.error = undefined
        entry.status = 'pending'
        entry.refreshing = false
        entry.live = true
        let cancelled = false
        const notify = () => {
            update()
            lifecycle.mark()
        }
        /*
        Seed-and-commit: frames from a retaining source accumulate silently
        until its in-band `replayed` boundary, then commit to the window in
        one update — readers never see the window rebuild frame-by-frame.
        An empty seed keeps the held window across a gap: nothing was
        replayed, so nothing can duplicate, and the live frames that follow
        append. Sources without the capability have no replay; their frames
        append directly.
        */
        let seeding = false
        let seed: T[] = []
        const commit = () => {
            if (cancelled || !seeding) {
                return
            }
            seeding = false
            if (seed.length > 0) {
                entry.window = seed
                seed = []
            }
            if (entry.window.length > 0) {
                entry.status = 'open'
            }
            entry.refreshing = false
            notify()
        }
        /*
        A retaining source bounds replay to what the reader keeps: 1 frame
        seeds the bare form, `last` seeds a window.
        */
        const open = () => {
            if (!subscribable.tail) {
                return subscribable[Symbol.asyncIterator]()
            }
            seeding = true
            seed = []
            return subscribable.tail(last, { replayed: commit })[Symbol.asyncIterator]()
        }
        /* `let`: the reconnect path swaps in a fresh iterator; teardown closes the current one. */
        let iterator = open()
        ;(async () => {
            while (!cancelled) {
                try {
                    const next = await iterator.next()
                    if (cancelled) {
                        return
                    }
                    if (next.done) {
                        /* a retaining source that ends without signalling still commits its seed */
                        commit()
                        if (entry.status !== 'error') {
                            entry.status = 'done'
                        }
                        entry.refreshing = false
                        notify()
                        return
                    }
                    if (seeding) {
                        seed.push(next.value)
                        if (seed.length > last) {
                            seed.shift()
                        }
                        continue
                    }
                    /*
                    Probes read only status/refreshing, so the registry
                    channel pings on transitions, not per frame — a chatty
                    stream must not re-derive every bare pending()/refreshing()
                    reader on each value. (A frame after a reconnect is the
                    seed landing — current again, hence a transition.)
                    */
                    const transitioned = entry.status !== 'open' || entry.refreshing
                    /* One copy per frame: take the surviving suffix, then append. */
                    const base = entry.window
                    const frames =
                        base.length < last ? base.slice() : base.slice(base.length - last + 1)
                    frames.push(next.value)
                    entry.window = frames
                    entry.status = 'open'
                    entry.refreshing = false
                    update()
                    if (transitioned) {
                        lifecycle.mark()
                    }
                } catch (error) {
                    if (cancelled) {
                        return
                    }
                    if (error instanceof SocketDisconnectedError) {
                        /*
                        Recoverable transport loss: retain the window, flag the
                        gap, reopen — open() re-arms seeding so the reopened
                        source's replay commits atomically over the held
                        window. The fresh sub frame queues on the channel and
                        flushes when its backoff attempt reconnects, so this
                        loop just awaits the next push — no spin.
                        */
                        entry.refreshing = entry.window.length > 0
                        notify()
                        iterator = open()
                        continue
                    }
                    entry.error = error instanceof Error ? error : new Error(String(error))
                    entry.status = 'error'
                    entry.refreshing = false
                    notify()
                    return
                }
            }
        })()
        lifecycle.mark()
        return () => {
            cancelled = true
            entry.live = false
            iterator.return?.(undefined)?.catch(() => undefined)
            if (evictIfCurrent(entry as Entry<unknown>)) {
                lifecycle.mark()
            }
        }
    })
    registry.set(key, entry as Entry<unknown>)
    return entry
}
