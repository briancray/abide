/*
RPC module — every file under src/server/rpc/ exposes exactly one RPC: a remote
function. The filename is the export name and the URL path (under `/rpc/`),
and the imported method helper (GET / POST / PUT / PATCH / DELETE / HEAD) picks
the HTTP method. The bundler swaps the runtime per build target: direct call on
the server, fetch over the network on the client.

Args (what the caller passes in) come from the handler's parameter type —
annotate the parameter and the body infers; a typed generic on the helper is a
compile error. Return (what the caller receives after Content-Type-driven
decoding) is inferred from the handler's return type via the `TypedResponse<T>`
brand on `json`/`error`/`redirect`/`jsonl`/`sse`, so plain
`GET(() => json({...}))` already types end-to-end.

For inbound validation pass a Standard Schema under `schemas.input` in the
second argument: `GET(fn, { schemas: { input } })`. Args then infers from the
schema's output type and the server replies with 422 on validation failure. An
optional `schemas.output` describes the success body for the OpenAPI 200
response and the MCP tool output; without one the handler's return type is
projected to JSON Schema.

`json(...)` from `abide/server/json` is a thin wrapper over `Response.json`
that defaults `Cache-Control: no-store`, since intermediary caches shouldn't
memoise rpc replies (the framework's per-request cache handles in-process
dedupe). Other helpers are siblings, one per file: `abide/server/error`,
`abide/server/redirect`, `abide/server/sse`, `abide/server/jsonl`.

Every rpc value also exposes `.raw(args?, init?)` (returns the underlying
`Response`) for callers that need headers or status. A streaming rpc — a
jsonl/sse handler — returns a `NamedAsyncIterable` over the frames from its bare
call (`fn(args)`); iterate it with `for await` or react to it with
`watch(fn(args), frame => …)`.
*/

import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'

export const getHello = GET(() => json({ message: 'Hello from abide' }))
