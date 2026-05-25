/*
Wire frame the server sends over the multiplexed socket-rpc connection.
`frame` carries one yielded value; `done` signals the handler iterator
returned; `error` signals it threw. Each frame carries the `id` minted
by the client so the proxy can route it back to the right AsyncIterable.

`error.message` is the only field forwarded from the thrown value so the
wire stays JSON-safe and server-side stack traces never leak to the
client; the framework logs the full error server-side via `log.error`.
*/
export type SocketServerFrame =
    | { type: 'frame'; id: string; value: unknown }
    | { type: 'done'; id: string }
    | { type: 'error'; id: string; message: string }
