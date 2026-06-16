import type { TailHooks } from './TailHooks.ts'

/*
The thing `tail()` reads from: an AsyncIterable carrying a stable `name`
used as the subscription registry key. Both `Socket<T>` (the declared
broadcast primitive) and the result of `fn.stream(args)` (per-call HTTP
stream consumer) satisfy this shape, so tail() can share one iterator
across multiple readers regardless of source.

The name on a Socket comes from the file path under `src/server/sockets/`.
The name on an fn.stream(args) result is `keyForRemoteCall(method, url,
args)` — the same key cache() uses — so two readers of the same remote-call
args dedupe to one underlying fetch.

`tail` is the optional retention capability: a source that keeps a tail of
recent frames hands back an iterable seeded with at most the last `count`
before going live. Sockets implement it verbatim; one-shot rpc streams omit
it. The tail() consumer uses it to bound replay to what the reader will
keep — it never requires it. Implementers must signal `hooks.replayed`
in-band once the seed portion is delivered (even when empty) so window
readers can commit atomically; see TailHooks.
*/
export interface Subscribable<T> extends AsyncIterable<T> {
    readonly name: string
    tail?(count: number, hooks?: TailHooks): AsyncIterable<T>
}
