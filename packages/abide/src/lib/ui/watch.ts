import { cache } from '../shared/cache.ts'
import { REMOTE_FUNCTION } from '../shared/REMOTE_FUNCTION.ts'
import type { CacheOnContext } from '../shared/types/CacheOnContext.ts'
import type { NamedAsyncIterable } from '../shared/types/NamedAsyncIterable.ts'
import type { RemoteFunction } from '../shared/types/RemoteFunction.ts'
import { effect } from './effect.ts'
import { generationGuard } from './runtime/generationGuard.ts'
import type { EffectResult } from './runtime/types/EffectResult.ts'
import type { State } from './runtime/types/State.ts'

/*
The single reaction primitive: `watch(source, handler)` names its trigger and runs
`handler` with the source's new value whenever it changes. It unifies three
previously-separate things — the author `effect`, `socket.on`, and `cache.on` —
and it is also the compiler's binding primitive (emitted as `$$watch(thunk)` for
`{expr}` / `class:` / `bind:*`). Client-only: SSR-inert here and stripped by the
compiler. Returns a scope-tied disposer.

Instance sugar mirrors the global for the two subscribable/rpc sources (the other
sources have no instance home): `socket.watch(handler)` ≡ `watch(socket, handler)`, and
`getUser.watch(handler)` / `getUser.watch(args, handler)` ≡ `watch(getUser, …)`. The
method is client-attached (socketProxy / remoteProxy) so this ui primitive never rides
into a server bundle; server-side it is an inert no-op. Unlike bare `watch(…)` — which
the SSR back-end strips — a `.watch(…)` member call survives to the server and relies on
that inert stub.

Sources (discriminated at runtime, monomorphic per branch):
  watch(thunk)                       // compiler binding form — auto-tracked, == effect(thunk)
  watch(count, n => …)               // a state cell → handler(newValue)
  watch([a, b], vals => …)           // multiple cells → fires on any change
  watch(socket, frame => …)          // a subscribable → handler per frame (cache.on loop)
  watch(getUser, user => …)          // an rpc → runs the smart read, handler(resolved value)
  watch(getUser, args, user => …)    // an rpc with args
*/
// @documentation reactive-state
export function watch(thunk: () => EffectResult): () => void
export function watch<T>(source: State<T>, handler: (value: T) => void): () => void
export function watch(
    sources: ReadonlyArray<State<unknown>>,
    handler: (values: unknown[]) => void,
): () => void
export function watch<Frame>(
    source: NamedAsyncIterable<Frame>,
    handler: (frame: Frame, context: CacheOnContext) => void | Promise<void>,
): () => void
export function watch<Args, Return>(
    fn: RemoteFunction<Args, Return>,
    handler: (value: Return) => void,
): () => void
export function watch<Args, Return>(
    fn: RemoteFunction<Args, Return>,
    args: Args,
    handler: (value: Return) => void,
): () => void
export function watch(
    source: unknown,
    argsOrHandler?: unknown,
    maybeHandler?: unknown,
): () => void {
    /* Client lifecycle, exactly like the effect it wraps: no runtime window guard (that would
       also silence the compiler's generated bindings, which build on the client where the test
       DOM sets no global `window`). SSR-safety comes from the compiler stripping author
       `watch(...)` calls, and the subscribable branch's own server guard (cache.on). */
    /* Compiler binding form watch(thunk): a bare auto-tracked effect (== today's $$effect). */
    if (argsOrHandler === undefined) {
        return effect(source as () => EffectResult)
    }
    /* watch(fn, args, handler): an rpc selector with explicit args. */
    if (maybeHandler !== undefined) {
        return reactToRpc(source, argsOrHandler, maybeHandler as (value: unknown) => void)
    }
    const handler = argsOrHandler as (value: unknown, context?: CacheOnContext) => void
    /* A subscribable (socket / stream): per-frame delivery with reconnect-replay — the
       existing cache.on loop is the single implementation this branch delegates to. */
    if (isSubscribable(source)) {
        return cache.on(
            source as NamedAsyncIterable<unknown>,
            handler as (frame: unknown, context: CacheOnContext) => void | Promise<void>,
        )
    }
    /* An rpc without args → run the smart read reactively, pipe its value to the handler. A
       RemoteFunction is a callable, so accept `function` too — a state cell is a branded-free
       object and never matches, and a streaming rpc was already caught by isSubscribable above. */
    if (
        source !== null &&
        (typeof source === 'object' || typeof source === 'function') &&
        REMOTE_FUNCTION in source
    ) {
        return reactToRpc(source, undefined, handler)
    }
    /* Multiple cells → fire on any change; hand the handler the current values. */
    if (Array.isArray(source)) {
        const cells = source as ReadonlyArray<State<unknown>>
        return effect(() => {
            const values = cells.map((cell) => cell.value)
            handler(values)
        })
    }
    /* A single state cell → handler(newValue) on change. */
    const cell = source as State<unknown>
    return effect(() => {
        handler(cell.value)
    })
}

/* True for a socket / rpc stream — anything async-iterable. */
function isSubscribable(source: unknown): boolean {
    return (
        source !== null &&
        (typeof source === 'object' || typeof source === 'function') &&
        typeof (source as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
    )
}

/*
Reacts to an rpc's cached value: an effect that runs the smart read (subscribing
its key synchronously, so the effect re-runs when the value changes — a refresh,
a patch, an invalidate) and pipes the resolved value to the handler. Triggers the
read, unlike peek: `watch` observes a live query, so it keeps it flowing.
*/
function reactToRpc(fn: unknown, args: unknown, handler: (value: unknown) => void): () => void {
    const call = fn as (args: unknown) => Promise<unknown>
    /* The bare call routes through cache.read (cache-managed flight, not scope-abortable), so
       a slow flight can settle AFTER a faster re-run's flight OR after the owner tears down.
       Guard the handler on the generation so only the current flight's value lands and a
       post-teardown settle is dropped — a re-run renews, teardown bumps (both via the shared
       generationGuard). */
    const guard = generationGuard()
    return effect(() => {
        const generation = guard.renew()
        void Promise.resolve(call(args)).then(
            (value) => {
                if (guard.live(generation)) {
                    handler(value)
                }
            },
            () => undefined,
        )
    })
}
