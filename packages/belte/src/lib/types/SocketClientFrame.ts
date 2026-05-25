/*
Wire frame the browser sends over the multiplexed socket-rpc connection.
`open` starts a subscription against `url` with `args`; the server replies
with one or more `frame` frames keyed by the same `id`. `close` cancels
an in-flight subscription — the server invokes `return()` on the handler
iterator and replies with a `done` frame.

`id` is minted client-side per call (monotonic integer in string form);
the server treats it as opaque.
*/
export type SocketClientFrame =
    | { type: 'open'; id: string; url: string; args: unknown }
    | { type: 'close'; id: string }
