/*
Wire frame the browser sends over the multiplexed socket connection.
`sub` opens a subscription against `socket`. The optional `replay`
controls history: omitted = full replay (default `for await`); a
number = at most that many trailing items (clamped server-side to the
topic's history max). `unsub` closes one. `pub` publishes a message —
the dispatcher checks the topic's `clientPublish` flag before fanning
out.

`sub` is the per-subscription id minted client-side; the server treats
it as opaque and routes inbound `msg|err|end` frames back to the same
id so one ws can multiplex many subscriptions to the same or different
sockets.
*/
export type SocketClientFrame =
    | { type: 'sub'; sub: string; socket: string; replay?: number }
    | { type: 'unsub'; sub: string }
    | { type: 'pub'; socket: string; message: unknown }
