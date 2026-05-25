/*
Socket-defined remote function reference produced by SOCKET inside an
`$rpc/**` module. Same callable shape on server and client — the bundler
swaps the implementation per build target (defineSocket on the server,
socketProxy on the client). Calling returns an AsyncIterable<Frame> that
yields server-pushed frames; `for await` consumes them and `break` /
`return` propagates a cancel frame to the server.

`.stream(args)` is an alias for the bare call so the iteration entry
point reads identically against `SocketFunction`s and `RemoteFunction`s
(`for await (… of fn.stream(args))` works regardless of transport).
`.url` is the flat rpc route (e.g. `/rpc/orderFeed`); `.dispatch` is the
framework's dispatch hook the ws router uses to invoke the handler from
an incoming frame (parallel to RemoteFunction's `.fetch`). User code
never calls `.dispatch` directly.
*/
export type SocketFunction<Args, Frame> = ((args: Args) => AsyncIterable<Frame>) & {
    readonly url: string
    stream(args: Args): AsyncIterable<Frame>
    dispatch(args: Args): AsyncIterable<Frame>
}
