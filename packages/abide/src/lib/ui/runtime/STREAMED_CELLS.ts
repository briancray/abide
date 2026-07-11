/*
Post-mount sink for STREAMING-cell resolutions (ADR-0035). Unlike `CELL_SEED` — the pre-mount
warm-seed a blocking cell reads at construction — a streaming cell ships pending and its value
arrives LATER (streamed after the shell, `__abideResolve({ cellKey, value })` →
`seedStreamedResolution`). So a mounted streaming cell registers an `apply` fn keyed by its
render-path id, and the streamed value is routed to it — the render-path analogue of the cache
path's `markLifecycle` wake. A value that arrives before its cell registers is buffered and applied
on registration (the two orderings race as the shell hydrates while chunks stream in).

Backed by `globalThis.__abideStreamedCells` so an inline pre-bundle script and the framework share
one store, mirroring `CELL_SEED`/`RESUME`.
*/
const globalScope = globalThis as {
    __abideStreamedCells?: {
        apply: Map<string, (value: unknown) => void>
        buffer: Map<string, unknown>
    }
}
globalScope.__abideStreamedCells ??= { apply: new Map(), buffer: new Map() }

const store = globalScope.__abideStreamedCells

/* Apply a streamed value to its cell as a POST-hydration reactive update. Deferred to a microtask
   so it can NEVER run inside the synchronous hydration mount: the streamed `__abideResolve` chunk
   parses (buffering the value) BEFORE the client mounts, so a synchronous apply at registration
   would set the cell to the resolved value while the SSR DOM still shows the pending text — an
   `assertClaimedText` desync (ADR-0033). The microtask runs after the whole synchronous mount
   tree unwinds, so hydration claims the pending markup first and the value lands as a plain
   reactive update (pending → resolved), congruent with a fresh mount. */
function deferApply(apply: (value: unknown) => void, value: unknown): void {
    queueMicrotask(() => apply(value))
}

/* A mounted streaming cell offers where to deliver its streamed value. If the value already
   arrived (buffered), schedule it; otherwise hold the apply fn for when it streams in. */
export function registerStreamedCell(key: string, apply: (value: unknown) => void): void {
    if (store.buffer.has(key)) {
        const value = store.buffer.get(key)
        store.buffer.delete(key)
        deferApply(apply, value)
        return
    }
    store.apply.set(key, apply)
}

/* A streamed value landed for `key`. Deliver it to the registered cell (scheduled post-mount), or
   buffer it until the cell registers. One-shot: the apply fn is consumed (a cell adopts a streamed
   value once; later reactivity is its own reseed). */
export function receiveStreamedCell(key: string, value: unknown): void {
    const apply = store.apply.get(key)
    if (apply !== undefined) {
        store.apply.delete(key)
        deferApply(apply, value)
        return
    }
    store.buffer.set(key, value)
}
