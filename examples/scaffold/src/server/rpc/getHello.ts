/*
RPC module — every file under src/server/rpc/ exposes exactly one RPC: a remote
function. The filename is the export name and the URL path (under `/rpc/`),
and the imported method helper (GET / POST / PUT / PATCH / DELETE / HEAD) picks
the HTTP method. The bundler swaps the runtime per build target: direct call on
the server, fetch over the network on the client.

Args (what the caller passes in) come from the handler's parameter type —
either an inline annotation or an explicit `GET<{ id: string }>(...)`
generic. Return (what the caller receives after Content-Type-driven
decoding) is inferred from the handler's return type via the
`TypedResponse<T>` brand on `json`/`error`/`redirect`/`jsonl`/`sse`, so
plain `GET(() => json({...}))` already types end-to-end.

For inbound validation pass a Standard Schema as `inputSchema` in the
second argument: `GET(fn, { inputSchema })`. Args then infers from the
schema's output type and the server replies with 422 on validation
failure. An optional `outputSchema` describes the success body for the
OpenAPI 200 response and the MCP tool output.

`json(...)` from `abide/server/json` is a thin wrapper over `Response.json`
that defaults `Cache-Control: no-store`, since intermediary caches shouldn't
memoise rpc replies (the framework's per-request cache handles in-process
dedupe). Other helpers are siblings, one per file: `abide/server/error`,
`abide/server/redirect`, `abide/server/sse`, `abide/server/jsonl`.

Every rpc value also exposes `.raw(args?)` (returns the underlying
`Response`) and `.stream(args?)` (returns a `Subscribable` over the frames —
feed it to `tail()`) for callers that need headers/status or want to iterate
jsonl/sse frames.
*/

import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'

export const getHello = GET(() => json({ message: 'Hello from abide' }))
