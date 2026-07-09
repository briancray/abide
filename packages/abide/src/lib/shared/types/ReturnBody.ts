/*
The build-time success-body descriptor for an rpc, derived from the handler's return type by the
warm server program (ADR-0030). Mirrors `RpcHelper`'s `SuccessBody<R>` projection: the handler's
`Awaited<ReturnType>` union has its `TypedError` branches dropped, and each success
`TypedResponse<Body>` contributes its `Body`. `type` is that body rendered as a TS type string
(the union of the surviving branches). For a streaming endpoint (`jsonl()`/`sse()` →
`TypedResponse<AsyncIterable<Frame>>`) `streaming` is true and `type` is the per-FRAME type — the
AsyncIterable element — so a consumer describes one streamed item rather than the iterable itself.
The query fails open to undefined (no handler/body resolvable), matching every other server-program
query.
*/
export type ReturnBody = {
    type: string
    streaming: boolean
}
