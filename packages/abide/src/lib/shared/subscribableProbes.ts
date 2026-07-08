import { createLifecycleChannel } from './createLifecycleChannel.ts'
import { tailProbeSlot } from './tailProbeSlot.ts'

type StreamStatus = 'pending' | 'open' | 'done' | 'error'

/* One registered consumption of a named subscribable — the stream-side analog of a
   cache-store entry. Populated by the consume path (cache.on / watch(socket)), read
   by the pending()/refreshing()/done()/error() probes. No window/value here: the
   value flows through the consumer (watch handler / for-await), the registry only
   holds probe state. */
type StreamEntry = {
    source: string
    status: StreamStatus
    refreshing: boolean
    error: Error | undefined
    /* Reconnect only counts as refreshing once a value has been seen (probe contract:
       value held, fresher source in flight — never a first-ever open). */
    everFramed: boolean
}

const registry = new Set<StreamEntry>()

/*
Registry-wide lifecycle channel for the subscribable probes — the stream-side
counterpart of the cache store's. Probes match entries by source name (or all)
without creating them, so they tap one "membership or state changed" signal and
re-derive by scanning.
*/
const lifecycle = createLifecycleChannel()

/*
Installs the prober the shared probes call for a NamedAsyncIterable (probeRegistries →
tailProbeSlot). Register-on-consume: an entry exists only while something is
consuming the stream, exactly as a cache entry exists only while a call is
retained. A name with no entry reads as "no value yet" (pending) without opening
anything — probes report, never act. This install replaces tail()'s: the registrar
moved from the (removed) tail() reader to the consume path.
*/
tailProbeSlot.probe = (name) => {
    lifecycle.track()
    const entries = [...registry].filter((entry) => name === undefined || entry.source === name)
    return {
        pending:
            (name !== undefined && entries.length === 0) ||
            entries.some((entry) => entry.status === 'pending'),
        refreshing: entries.some((entry) => entry.refreshing),
        /* Terminal only when there is at least one entry and all of them have closed. */
        done: entries.length > 0 && entries.every((entry) => entry.status === 'done'),
        error: entries.find((entry) => entry.error !== undefined)?.error,
    }
}

export type StreamProbe = {
    frame(): void
    reconnecting(): void
    done(): void
    errored(error: Error): void
    close(): void
}

/*
Opens a probe entry for a consumed named subscribable and returns the handle the
consume loop drives: `frame()` on each delivered value (pending → open), plus the
terminal/lifecycle transitions. `close()` evicts on teardown. Reactivity is the
registry lifecycle channel, marked on every transition.
*/
export function openStreamProbe(source: string): StreamProbe {
    const entry: StreamEntry = {
        source,
        status: 'pending',
        refreshing: false,
        error: undefined,
        everFramed: false,
    }
    registry.add(entry)
    lifecycle.mark()
    return {
        frame() {
            /* Only ping on a real transition (pending→open, or refreshing clearing) so a
               chatty stream doesn't re-derive every bare probe reader on each value. */
            const transitioned = entry.status !== 'open' || entry.refreshing
            entry.status = 'open'
            entry.refreshing = false
            entry.everFramed = true
            if (transitioned) {
                lifecycle.mark()
            }
        },
        reconnecting() {
            entry.refreshing = entry.everFramed
            lifecycle.mark()
        },
        done() {
            if (entry.status !== 'error') {
                entry.status = 'done'
            }
            entry.refreshing = false
            lifecycle.mark()
        },
        errored(error: Error) {
            entry.error = error
            entry.status = 'error'
            entry.refreshing = false
            lifecycle.mark()
        },
        close() {
            registry.delete(entry)
            lifecycle.mark()
        },
    }
}
