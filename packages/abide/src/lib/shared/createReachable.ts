/*
The reachability registry behind `abide/shared/reachable`. A probe transport and the
TTL are injected so the public name wires them from env + a real HEAD while tests drive
scripted outcomes.

Per origin, a TTL memoize: the first read — and any read after the cached verdict has
aged past `ttlMs` — awaits a real probe (the FAITHFUL answer; its latency, a full timeout
when the host is down, is the price of not guessing) and caches the verdict with its
timestamp. Every read within the TTL resolves instantly off that cached value. Concurrent
reads of a cold/stale origin share the one in-flight probe. No background poll: a host that
goes down (or recovers) is noticed on the next read after its entry ages out, not
continuously.
*/
export function createReachable(options: {
    probe: (origin: string) => Promise<boolean>
    ttlMs: number
}): {
    reachable: (host: string | URL) => Promise<boolean>
    /* Drop every cached verdict — graceful reset and test isolation. */
    stop: () => void
    /* `using registry = createReachable(...)` — disposal clears the cache. */
    [Symbol.dispose]: () => void
} {
    type Entry = {
        alive: boolean
        /* `Date.now()` when `alive` was taken; a read past `ttlMs` re-probes. */
        probedAt: number
        /* A probe in flight — concurrent cold/stale reads await the same one. */
        inflight: Promise<boolean> | undefined
    }
    const cache = new Map<string, Entry>()

    /* Re-probe an origin, folding the verdict + its timestamp back into the entry. A rejecting
       probe reads as unreachable, not a permanent wedge (without the catch a thrown probe would
       leave `inflight` set forever). */
    function refresh(origin: string, entry: Entry): Promise<boolean> {
        entry.inflight = options
            .probe(origin)
            .catch(() => false)
            .then((alive) => {
                entry.alive = alive
                entry.probedAt = Date.now()
                entry.inflight = undefined
                return alive
            })
        return entry.inflight
    }

    function reachable(host: string | URL): Promise<boolean> {
        /* HEAD the origin root: host connectivity, not endpoint health. A bare host defaults to
           https (the external-dependency norm); an explicit http://… is honored. */
        const url =
            typeof host === 'string' && !/^https?:\/\//i.test(host) ? `https://${host}` : host
        const origin = new URL(url).origin
        const existing = cache.get(origin)
        if (existing !== undefined) {
            /* A probe already running → share it (dedupes concurrent cold/stale reads). */
            if (existing.inflight !== undefined) {
                return existing.inflight
            }
            /* Fresh within the TTL → instant warm read. */
            if (Date.now() - existing.probedAt < options.ttlMs) {
                return Promise.resolve(existing.alive)
            }
            /* Aged out → re-probe on this read. */
            return refresh(origin, existing)
        }
        const entry: Entry = { alive: true, probedAt: 0, inflight: undefined }
        cache.set(origin, entry)
        return refresh(origin, entry)
    }

    function stop(): void {
        cache.clear()
    }

    return { reachable, stop, [Symbol.dispose]: stop }
}
