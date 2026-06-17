/*
Memoises an async loader keyed by string: the first call for a key starts the
load and caches its promise; later calls reuse it. `load` returns undefined when
the key has no loader, which is passed through (and not cached) so the caller can
treat "unknown key" distinctly from "loaded value". Used by the rpc-module and
socket-module load caches, which share this exact shape.
*/
export function memoizeByKey<T>(
    load: (key: string) => Promise<T> | undefined,
): (key: string) => Promise<T> | undefined {
    const cache = new Map<string, Promise<T>>()
    return (key) => {
        const existing = cache.get(key)
        if (existing) {
            return existing
        }
        const started = load(key)
        if (!started) {
            return undefined
        }
        cache.set(key, started)
        // Evict on rejection so a transient load failure doesn't poison the key
        // forever; the next call retries. The separate handle doesn't swallow the
        // rejection seen by the returned promise.
        void started.catch(() => {
            if (cache.get(key) === started) {
                cache.delete(key)
            }
        })
        return started
    }
}
