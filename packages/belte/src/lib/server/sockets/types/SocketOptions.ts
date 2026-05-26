/*
Server-side options passed when declaring a socket via `socket<T>(opts)`.
History buffer (replayed on first iteration), per-frame TTL (history
entries older than `ttl` ms are evicted before replay), and the client-
publish gate (off by default — server-only topics ignore pub frames
coming over the wire). All server-only state the bundler strips out of
the client stub.
*/
export type SocketOptions = {
    history?: number
    ttl?: number
    clientPublish?: boolean
}
