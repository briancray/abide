/*
RPC module — every file under src/server/rpc/ exposes exactly one verb-bound remote
function. The filename is the export name and the URL path (under `/rpc/`),
and the imported verb (GET / POST / PUT / PATCH / DELETE / HEAD) picks the
HTTP method. The bundler swaps the runtime per build target: direct call on
the server, fetch over the network on the client.

Args (what the caller passes in) come from the handler's parameter type —
either an inline annotation or an explicit `GET<{ id: string }>(...)`
generic. Return (what the caller receives after Content-Type-driven
decoding) is inferred from the handler's return type via the
`TypedResponse<T>` brand on `json`/`error`/`redirect`/`jsonl`/`sse`, so
plain `GET(() => json({...}))` already types end-to-end.

For inbound validation pass a Standard Schema-compatible schema as the
second argument: `GET(fn, { schema })`. Args then infers from the schema's
output type and the server replies with 422 on validation failure.

`json(...)` from `belte/server/json` is a thin wrapper over `Response.json`
that defaults `Cache-Control: no-store`, since intermediary caches shouldn't
memoise rpc replies (the framework's per-request cache handles in-process
dedupe). Other helpers are siblings, one per file: `belte/server/error`,
`belte/server/redirect`, `belte/server/sse`, `belte/server/jsonl`.

Every rpc value also exposes `.raw(args?)` (returns the underlying
`Response`) and `.stream(args?)` (returns a `Subscribable` view of the body)
for callers that need headers/status or want to iterate SSE/JSONL frames.
*/

import { GET } from '@briancray/belte/server/GET'
import { json } from '@briancray/belte/server/json'

export const getHello = GET(() => json({ message: 'Hello from belte' }))
