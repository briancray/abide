import type { StandardSchemaV1 } from './types/StandardSchemaV1.ts'

/*
Attaches a `toJSONSchema()` projection to a Standard Schema whose library
doesn't expose one natively. jsonSchemaForSchema probes that method to feed the
OpenAPI document, the MCP tool schemas, the CLI flag help, and the bundle setup
form. Zod 4 / Effect / Arktype carry their own; everything else wraps once where
the schema is declared:

  export const config = env(withJsonSchema(vSchema, (s) => toJsonSchema(s)))

Mutates and returns the same schema with the method attached, so the wrapped
value stays usable everywhere the bare schema was.
*/
// @readme rpc
export function withJsonSchema<Schema extends StandardSchemaV1>(
    schema: Schema,
    toJsonSchema: (schema: Schema) => Record<string, unknown>,
): Schema & { toJSONSchema: () => Record<string, unknown> } {
    return Object.assign(schema, { toJSONSchema: () => toJsonSchema(schema) })
}
