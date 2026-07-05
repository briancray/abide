import { cache } from '../shared/cache.ts'
import { REMOTE_FUNCTION } from '../shared/REMOTE_FUNCTION.ts'
import type { CacheOnContext } from '../shared/types/CacheOnContext.ts'
import type { RemoteFunction } from '../shared/types/RemoteFunction.ts'
import type { Subscribable } from '../shared/types/Subscribable.ts'
import { effect } from './effect.ts'
import type { EffectResult } from './runtime/types/EffectResult.ts'
import type { State } from './runtime/types/State.ts'

/*
The single reaction primitive: `on(source, handler)` names its trigger and runs
`handler` with the source's new value whenever it changes. It unifies three
previously-separate things — the author `effect`, `socket.on`, and `cache.on` —
and it is also the compiler's binding primitive (emitted as `$$on(thunk)` for
`{expr}` / `class:` / `bind:*`). Client-only: SSR-inert here and stripped by the
compiler. Returns a scope-tied disposer.

Sources (discriminated at runtime, monomorphic per branch):
  on(thunk)                       // compiler binding form — auto-tracked, == effect(thunk)
  on(count, n => …)               // a state cell → handler(newValue)
  on([a, b], vals => …)           // multiple cells → fires on any change
  on(socket, frame => …)          // a subscribable → handler per frame (cache.on loop)
  on(getUser, user => …)          // an rpc → runs the smart read, handler(resolved value)
  on(getUser, args, user => …)    // an rpc with args
*/
// @documentation reactive-state
export function on(thunk: () => EffectResult): () => void
export function on<T>(source: State<T>, handler: (value: T) => void): () => void
export function on(
    sources: ReadonlyArray<State<unknown>>,
    handler: (values: unknown[]) => void,
): () => void
export function on<Frame>(
    source: Subscribable<Frame>,
    handler: (frame: Frame, context: CacheOnContext) => void | Promise<void>,
): () => void
export function on<Args, Return>(
    fn: RemoteFunction<Args, Return>,
    handler: (value: Return) => void,
): () => void
export function on<Args, Return>(
    fn: RemoteFunction<Args, Return>,
    args: Args,
    handler: (value: Return) => void,
): () => void
export function on(source: unknown, argsOrHandler?: unknown, maybeHandler?: unknown): () => void {
    /* Reactions are client lifecycle — inert on the server (the compiler also strips the call). */
    if (typeof window === 'undefined') {
        return () => undefined
    }
    /* Compiler binding form on(thunk): a bare auto-tracked effect (== today's $$effect). */
    if (argsOrHandler === undefined) {
        return effect(source as () => EffectResult)
    }
    /* on(fn, args, handler): an rpc selector with explicit args. */
    if (maybeHandler !== undefined) {
        return reactToRpc(source, argsOrHandler, maybeHandler as (value: unknown) => void)
    }
    const handler = argsOrHandler as (value: unknown, context?: CacheOnContext) => void
    /* A subscribable (socket / stream): per-frame delivery with reconnect-replay — the
       existing cache.on loop is the single implementation this branch delegates to. */
    if (isSubscribable(source)) {
        return cache.on(
            source as Subscribable<unknown>,
            handler as (frame: unknown, context: CacheOnContext) => void | Promise<void>,
        )
    }
    /* An rpc without args → run the smart read reactively, pipe its value to the handler. */
    if (source !== null && typeof source === 'object' && REMOTE_FUNCTION in source) {
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
read, unlike peek: `on` observes a live query, so it keeps it flowing.
*/
function reactToRpc(fn: unknown, args: unknown, handler: (value: unknown) => void): () => void {
    const call = fn as (args: unknown) => Promise<unknown>
    return effect(() => {
        void Promise.resolve(call(args)).then(handler, () => undefined)
    })
}
