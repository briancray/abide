// decodeQueryArgs — build a read RPC's args object from FLAT query params (`?key=beta&n=5`), the
// hand-testable / curl-friendly form. Used only when the canonical `__abide_args` JSON blob is absent
// (machine callers still emit that; see RPC_QUERY_PARAMS). Query values are always strings, so each is
// coerced to the type its `input` schema property declares — mirroring `projectFormText` (multipart
// text) and `env` — via the shared `coerceStringToType`. When the schema is opaque or a field's type
// is undeclared (e.g. a type-derived RPC with no runtime schema), the raw string passes through and
// any downstream validation, not this decoder, produces the loud 422. Reserved params
// (`__abide_args`, `__abide_from`) are never treated as args. A repeated key promotes to an array
// (URLSearchParams.getAll semantics).

import type { JSONSchema } from '../../shared/internal/jsonSchema.ts'
import { coerceStringToType, singleType } from '../../shared/internal/jsonSchema.ts'
import { RPC_QUERY_PARAMS } from '../../shared/internal/RPC_QUERY_PARAMS.ts'
import { jsonSchemaOf } from '../../shared/internal/shapeToSchema.ts'
import type { StandardSchemaV1 } from '../../shared/StandardSchema.ts'

const RESERVED = new Set<string>([RPC_QUERY_PARAMS.args, RPC_QUERY_PARAMS.from])

export function decodeQueryArgs(
    searchParams: URLSearchParams,
    inputSchema: StandardSchemaV1 | JSONSchema | undefined,
): Record<string, unknown> {
    const properties = inputSchema !== undefined ? jsonSchemaOf(inputSchema)?.properties : undefined
    const out: Record<string, unknown> = {}
    const seen = new Set<string>()
    for (const name of searchParams.keys()) {
        if (RESERVED.has(name) || seen.has(name)) continue // getAll collapses repeats; visit each once
        seen.add(name)
        const type = singleType(properties?.[name]?.type)
        const coerced: unknown[] = []
        for (const value of searchParams.getAll(name)) coerced.push(coerceStringToType(value, type))
        out[name] = coerced.length === 1 ? coerced[0] : coerced
    }
    return out
}
