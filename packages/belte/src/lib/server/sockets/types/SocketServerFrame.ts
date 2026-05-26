/*
Wire frame the server sends over the multiplexed socket connection.

`msg` is keyed by socket name (not sub id) because one publish fans
out to every client subscribed to the socket via Bun's native
publish — the client demuxes against every local sub of that socket.
`end` and `err` are per-sub because they're subscription-lifecycle
events; `err.message` is the only thrown-value field forwarded so the
wire stays JSON-safe and server-side stack traces never reach the
client.
*/
export type SocketServerFrame =
    | { type: 'msg'; socket: string; message: unknown }
    | { type: 'end'; sub: string }
    | { type: 'err'; sub: string; message: string }
