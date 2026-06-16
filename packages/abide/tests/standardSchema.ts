import type { StandardSchemaV1 } from '../src/lib/shared/types/StandardSchemaV1.ts'

/*
Minimal Standard Schema for tests: validation is pass-through (every
payload is accepted, returned unchanged) so tests exercise the happy
path without pulling in zod/valibot. An optional JSON Schema is exposed
via `toJSONSchema()` — the hook jsonSchemaForSchema reads — so MCP
input/output schemas and OpenAPI bodies have a real shape to assert on.
*/
export function testSchema<T = Record<string, unknown>>(
    jsonSchema?: Record<string, unknown>,
): StandardSchemaV1<T, T> {
    const schema: StandardSchemaV1<T, T> = {
        '~standard': {
            version: 1,
            vendor: 'abide-test',
            validate: (value: unknown) => ({ value: value as T }),
        },
    }
    if (jsonSchema) {
        Object.assign(schema, { toJSONSchema: () => jsonSchema })
    }
    return schema
}
