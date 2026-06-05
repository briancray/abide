import type { StandardSchemaV1 } from './types/StandardSchemaV1.ts'

const OPAQUE = { type: 'object', additionalProperties: true } as const

/*
Resolves a JSON Schema for an MCP tool's `inputSchema`, an OpenAPI body, a CLI
flag set, or the bundle setup form. Probes the schema's own projection:

  1. `schema.toJsonSchema()` (Arktype 2+)
  2. `schema.toJSONSchema()` (Zod 4, Effect Schema, or a withJsonSchema wrap)
  3. Opaque object — the surface still works, the consumer just gets no shape hint

Schemas whose library exposes neither carry one via withJsonSchema. Returns a
fresh object each call; callers can mutate (e.g. add a description) without
aliasing the schema's own.
*/
export function jsonSchemaForSchema(schema: StandardSchemaV1 | undefined): Record<string, unknown> {
    if (!schema) {
        return { ...OPAQUE }
    }
    const candidate = schema as unknown as {
        toJsonSchema?: () => Record<string, unknown>
        toJSONSchema?: () => Record<string, unknown>
    }
    if (typeof candidate.toJsonSchema === 'function') {
        return { ...candidate.toJsonSchema() }
    }
    if (typeof candidate.toJSONSchema === 'function') {
        return { ...candidate.toJSONSchema() }
    }
    return { ...OPAQUE }
}
