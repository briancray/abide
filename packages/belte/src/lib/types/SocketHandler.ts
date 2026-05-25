/*
Handler signature for socket-defined remote functions. Args is the JSON-
shaped object the caller passes (or `undefined` for no-arg subscriptions);
the handler yields Frame values until it returns. Cancellation flows
through the iterator's `return()` — when the client unsubscribes (or the
ws disconnects), the dispatcher invokes `return()` on the iterator so a
`for await` inside the handler exits its loop via the normal control
path.
*/
export type SocketHandler<Args, Frame> = (args: Args) => AsyncIterable<Frame>
