import type { TypedResponse } from './TypedResponse.ts'

/*
Handler signature for verb-defined remote functions. Args is `undefined` for
GETs/DELETEs with no query, JSON-shaped objects for json bodies, and
form-shaped objects for form-encoded bodies. For a multipart upload it's the
text fields (`inputSchema`) intersected with the validated File parts
(`filesSchema`), merged into one bag. For a raw binary body Args is `undefined`
— read the stream via `request()` from `belte/server` instead.

Return is the value type the call site sees after Content-Type-driven
decoding (a parsed object for JSON, a string for text/*, a Blob otherwise,
`undefined` for 204). The handler must return a Response at runtime; the
`TypedResponse<Return>` brand on `json`/`error`/`redirect`/`jsonl`/`sse`
carries the body shape through the function's inferred return type so the
verb helper can infer `Return` automatically — no need to annotate
`GET<Args, Return>` when the handler returns one of the respond helpers.
A bare `new Response(...)` is still acceptable: the brand is optional, so
untagged Responses fall back to `Return = unknown`.

Handlers that need the inbound Request (headers, `request.signal`, …) read
it via `request()` from `belte/server` rather than a handler parameter, so
the signature stays a single parsed-`args` bag.
*/
export type RemoteHandler<Args, Return> = (
    args: Args,
) => TypedResponse<Return> | Promise<TypedResponse<Return>>
