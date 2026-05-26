import type { RemoteFunction } from '../types/RemoteFunction.ts'
import type { RemoteHandler } from '../types/RemoteHandler.ts'
import type { StandardSchemaV1 } from '../types/StandardSchemaV1.ts'

/*
Declares a remote handler inside an `$route/**` module. Each file
contains exactly one export, named after the file (e.g. `getUser.ts` →
`export const getUser = ...`). The verb is the import you use:
`GET(fn)`, `POST(fn)`, etc. The bundler reads the export name from the
filename, the verb from the call expression, and the URL from the file
path under `src/route/`, then rewrites this call to bind all three into
the runtime implementation (defineVerb on the server, remoteProxy on
the client).

`Return` is inferred from the handler's return type via the
`TypedResponse<T>` brand carried by `json`/`error`/`redirect`/`jsonl`/
`sse` — annotating `GET<Args, Return>` is only necessary when the
handler builds a bare `new Response(...)` (untagged → `unknown`).

An optional second argument `{ schema }` accepts any Standard
Schema-compatible schema (zod, valibot, arktype, …). When set, the
server validates inbound args against the schema before invoking the
handler and replies with `422 Unprocessable Content` on failure. The
handler receives the schema's *output* type; callers pass the *input*
type. Validation is server-side only — the client bundle stub never
sees the schema or its library, so there's no browser bundle cost. On
the schema overload `Return` comes first in the generic list so users
can write `GET<MyReturn>(fn, { schema })` when they need to override
inference; `Schema` still infers from `opts.schema`.

For broadcast/pub-sub use the `belte/stream` primitive — every
multiplexed ws fan-out lives under `src/stream/` now.

The functions here exist only for the type signature; calling one
directly means the bundler plugin didn't process the file, which
throws.
*/
function unprocessed<Args, Return>(verb: string): RemoteFunction<Args, Return> {
    throw new Error(
        `[belte] \`${verb}\` was called outside an $route module — verb helpers are only valid as the value of \`export const <filename> = ...\` inside a file under src/route/`,
    )
}

type VerbHelper = {
    <Return = unknown, Schema extends StandardSchemaV1 = StandardSchemaV1>(
        fn: RemoteHandler<StandardSchemaV1.InferOutput<Schema>, Return>,
        opts: { schema: Schema },
    ): RemoteFunction<StandardSchemaV1.InferInput<Schema>, Return>
    <Args = undefined, Return = unknown>(
        fn: RemoteHandler<Args, Return>,
    ): RemoteFunction<Args, Return>
}

export const GET: VerbHelper = (_fn: any, _opts?: any) => unprocessed('GET')
export const POST: VerbHelper = (_fn: any, _opts?: any) => unprocessed('POST')
export const PUT: VerbHelper = (_fn: any, _opts?: any) => unprocessed('PUT')
export const PATCH: VerbHelper = (_fn: any, _opts?: any) => unprocessed('PATCH')
export const DELETE: VerbHelper = (_fn: any, _opts?: any) => unprocessed('DELETE')
export const HEAD: VerbHelper = (_fn: any, _opts?: any) => unprocessed('HEAD')
