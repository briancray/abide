import { cache } from './cache.ts'
import { isAsyncCell } from './isAsyncCell.ts'
import { isAsyncIterable } from './isAsyncIterable.ts'
import type { AsyncComputed } from './types/AsyncComputed.ts'
import type { RemoteFunction } from './types/RemoteFunction.ts'
import type { Socket } from './types/Socket.ts'

/*
The value member of the probe family: the currently-retained value, synchronously,
without triggering anything — `T | undefined` (undefined when nothing is retained
yet). For a cached read it is the retained cache value (reactive in a tracking
scope — re-runs when a refresh lands or an amend mutates it; a one-shot snapshot
otherwise). For a subscribable (socket / stream) it is the latest frame, read off
the source's own `.peek()`. Instance sugar `getFoo.peek(args?)` ≡ `peek(getFoo,
args?)`, `socket.peek()` ≡ `peek(socket)`.

  peek(getFoo, args?)   → the retained value for that call
  peek(socket)          → the latest frame
*/
// @documentation probes
export function peek<Args, Return>(
    fn: RemoteFunction<Args, Return>,
    args?: Args,
): Return | undefined
export function peek<T>(source: Socket<T>): T | undefined
export function peek<T>(cell: AsyncComputed<T>): T | undefined
export function peek(source: unknown, args?: unknown): unknown {
    /* Null-tolerant: a promise/iterable subexpression peek-lifts to `undefined` while
       pending (ADR-0032), so `peek(getFeed())` in a template hands us `undefined` on the
       first pass — return `undefined` rather than routing a missing source into the cache. */
    if (source == null) {
        return undefined
    }
    /* An async cell carries its own probe surface — route to its method (`peek(cell)` ≡
       `cell.peek()`), the same instance/standalone equivalence as an rpc or socket. */
    if (isAsyncCell(source)) {
        return source.peek()
    }
    /* A subscribable (socket/stream) carries its own latest-frame probe; an rpc does not
       have Symbol.asyncIterator, so this cleanly splits the two even though both expose a
       `.peek` method. */
    if (isAsyncIterable(source)) {
        return (source as unknown as { peek: () => unknown }).peek()
    }
    return cache.peek(source as RemoteFunction<unknown, unknown>, args as never)
}
