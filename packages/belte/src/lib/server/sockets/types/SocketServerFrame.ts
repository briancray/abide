/*
Wire frame the server sends over the multiplexed socket connection.

`msg` is keyed by socket name (not sub id) because one publish fans
out to every client subscribed to the socket via Bun's native
publish — the client demuxes against every local sub of that socket.

`replay` is per-sub and batched: one frame carries the sub's requested
slice of the retained tail (possibly empty), sent on sub before live
fan-out reaches it. The batch is the wire's replay/live demarcation —
a window reader commits its seed atomically at the boundary — and the
per-sub address keeps one sub's replay out of sibling subs on the same
socket.

`end` and `err` are per-sub because they're subscription-lifecycle
events; `err.message` is the only thrown-value field forwarded so the
wire stays JSON-safe and server-side stack traces never reach the
client.
*/
export type SocketServerFrame =
    | { type: 'msg'; socket: string; message: unknown }
    | { type: 'replay'; sub: string; messages: unknown[] }
    | { type: 'end'; sub: string }
    | { type: 'err'; sub: string; message: string }
