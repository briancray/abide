/*
The thing `subscribe()` reads from: an AsyncIterable carrying a stable
`name` used as the subscription registry key. Both `Socket<T>` (the
declared broadcast primitive) and the result of `fn.stream(args)`
(per-call HTTP stream consumer) satisfy this shape, so subscribe() can
share one iterator across multiple readers regardless of source.

The name on a Socket comes from the file path under `src/server/sockets/`.
The name on an fn.stream(args) result is `keyForRemoteCall(method, url,
args)` — the same key cache() uses — so two subscribers to the same
remote-call args dedupe to one underlying fetch.
*/
export interface Subscribable<T> extends AsyncIterable<T> {
    readonly name: string
}
