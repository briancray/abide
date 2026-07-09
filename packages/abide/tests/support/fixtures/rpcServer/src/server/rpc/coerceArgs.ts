import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'

/* Schemaless GET whose handler annotates its arg types. The Args bag (the RemoteFunction's wire
   `InferInput`) is read off the export's call signature, so numeric/boolean fields — including an
   optional one and an array — get a build-time coercion plan; string fields and unknowns are left
   out so they stay strings (ADR-0028). */
export const coerceArgs = GET(
    (args: { id: number; active: boolean; name: string; tags: number[]; page?: number }) =>
        json(args),
)
