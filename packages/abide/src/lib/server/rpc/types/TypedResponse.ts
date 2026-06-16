/*
A `Response` tagged with the body type the framework will hand back to
callers after Content-Type-driven decoding. The tag is phantom — it
adds no runtime field, only a type-level slot so the verb helpers can
infer `Return` from the handler's return type instead of forcing every
route to annotate it via `GET<Args, Return>`.

The respond helpers (`json<T>`, `error`, `redirect`, `jsonl<F>`,
`sse<F>`) all return a `TypedResponse<T>`, so a handler ending in
`return json({ user })` exposes `{ user: ... }` as its body type; the
verb overload picks it up via `RemoteHandler<Args, Return>`.

`T` is optional on the brand so a plain `new Response(...)` (untagged)
remains assignable to `TypedResponse<unknown>`; in that case `Return`
just falls back to its `unknown` default, matching pre-existing
behaviour for handlers that build Responses by hand.
*/
export type TypedResponse<T> = Response & { readonly __body?: T }
