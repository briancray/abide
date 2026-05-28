import type { StandardSchemaV1 } from '../server/rpc/types/StandardSchemaV1.ts'

const OPAQUE = { type: 'object', additionalProperties: true } as const

/*
Resolves a JSON Schema for an MCP tool's `inputSchema` or a resource's
payload type. Priority:

  1. Explicit `jsonSchema` field on the verb/socket opts (user-supplied)
  2. `schema.toJsonSchema()` (Arktype 2+)
  3. `schema.toJSONSchema()` (Zod 4, Effect Schema, etc.)
  4. Opaque object — the tool still works, the model just gets no shape hint

Returns a fresh object each call; callers can mutate (e.g. add a
description) without aliasing.
*/
export function jsonSchemaForSchema(
    schema: StandardSchemaV1 | undefined,
    jsonSchema: Record<string, unknown> | undefined,
): Record<string, unknown> {
    if (jsonSchema) {
        return { ...jsonSchema }
    }
    if (!schema) {
        return { ...OPAQUE }
    }
    const candidate = schema as unknown as {
        toJsonSchema?: () => Record<string, unknown>
        toJSONSchema?: () => Record<string, unknown>
    }
    if (typeof candidate.toJsonSchema === 'function') {
        return candidate.toJsonSchema()
    }
    if (typeof candidate.toJSONSchema === 'function') {
        return candidate.toJSONSchema()
    }
    return { ...OPAQUE }
}
