import type { CacheSelector } from './CacheSelector.ts'

/*
Capabilities handed to a cache.on handler — exactly what behaves differently
inside a binding. `invalidate` is the binding-scoped copy of cache.invalidate
(same selector grammar, same effect): calls through it are recorded in the
binding's coverage set by function identity, so attribution survives awaits
and the coverage replays after a reconnect gap; the global cache.invalidate
still works inside a handler but is not covered. `signal` aborts when the binding
is disposed, so an async handler mid-flight can bail or cancel its own fetches.
*/
export type CacheOnContext = {
    invalidate: <Args, Return>(arg?: CacheSelector<Args, Return>, args?: Args) => void
    signal: AbortSignal
}
