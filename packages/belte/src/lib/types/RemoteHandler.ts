import type { TypedResponse } from './TypedResponse.ts'

/*
Handler signature for verb-defined remote functions. Args is `undefined` for
GETs/DELETEs with no query, JSON-shaped objects for json bodies, and
form-shaped objects for form-encoded bodies. For binary or multipart bodies
Args is `undefined` — read the raw Request via `request()` from
`belte/server` instead.

Return is the value type the call site sees after Content-Type-driven
decoding (a parsed object for JSON, a string for text/*, a Blob otherwise,
`undefined` for 204). The handler must return a Response at runtime; the
`TypedResponse<Return>` brand on `json`/`error`/`redirect`/`jsonl`/`sse`
carries the body shape through the function's inferred return type so the
verb helper can infer `Return` automatically — no need to annotate
`GET<Args, Return>` when the handler returns one of the respond helpers.
A bare `new Response(...)` is still acceptable: the brand is optional, so
untagged Responses simply fall back to `Return = unknown`.
*/
export type RemoteHandler<Args, Return> = (
    args: Args,
) => TypedResponse<Return> | Promise<TypedResponse<Return>>
