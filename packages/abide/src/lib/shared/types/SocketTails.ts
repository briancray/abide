/*
The per-request list of retained socket frames read via `peek(socket)` during an SSR render, each
keyed by the socket's name. `defineSocket`'s server `peek()` pushes an entry when a retained frame is
read server-side; the page renderer stamps them into `__SSR__.sockets` (ref-json-encoded, last write
per name winning) so the client seeds the socket's latest frame WARM — a not-yet-connected client's
`peek(socket)` then returns the same retained value the SSR render committed to instead of `undefined`,
which would otherwise diverge from the server HTML and trip a hydration desync. Sibling of
`ResolvedCells` — sockets carry a server value forward like cells, not withhold on the client like
cache (whose server peek is uniformly undefined).
*/
export type SocketTails = {
    entries: { name: string; value: unknown }[]
}
