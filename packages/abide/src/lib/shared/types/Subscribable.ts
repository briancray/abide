import type { TailHooks } from './TailHooks.ts'

/*
A named async stream: an AsyncIterable carrying a stable `name` used as the
subscription registry key. Both `Socket<T>` (the declared broadcast
primitive) and a streaming rpc's bare call (a `jsonl`/`sse` handler makes
the call return the stream itself) satisfy this shape, so the consume path
(`watch` → `cache.on`) and the stream probes (`pending`/`refreshing`/
`done`/`error`) handle either source through one contract.

The name on a Socket comes from the file path under `src/server/sockets/`.
The name on a streaming rpc call is `keyForRemoteCall(method, url, args)` —
the same key the smart call's cache store uses — so two readers of the same
remote-call args dedupe to one underlying fetch.

`tail` is the optional retention capability: a source that keeps a tail of
recent frames hands back an iterable seeded with at most the last `count`
before going live. Sockets implement it verbatim (it also backs the socket's
HTTP/SSE read face); one-shot rpc streams omit it. Implementers must signal
`hooks.replayed` in-band once the seed portion is delivered (even when
empty) so a seeded reader can commit its window atomically; see TailHooks.
*/
export interface Subscribable<T> extends AsyncIterable<T> {
    readonly name: string
    tail?(count: number, hooks?: TailHooks): AsyncIterable<T>
}
