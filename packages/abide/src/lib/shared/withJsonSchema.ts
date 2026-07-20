// withJsonSchema(schema) — wrap a raw JSON Schema as a Standard Schema that ALSO exposes
// `toJSONSchema()`. An RPC can then declare a hand-written JSON-Schema input/output that both
// VALIDATES at runtime (through the Standard Schema `~standard.validate`) and surfaces its JSON
// Schema to the machine surfaces (OpenAPI 3.1 / MCP tool props) — without abide having to guess the
// schema back from a validator. Isomorphic (pure); safe on either side.

import { asStandardSchema, type JSONSchema } from "./internal/jsonSchema.ts";
import type { StandardSchemaV1 } from "./StandardSchema.ts";

export type SchemaWithJsonSchema = StandardSchemaV1 & { toJSONSchema(): JSONSchema };

export function withJsonSchema(schema: JSONSchema): SchemaWithJsonSchema {
  const standard = asStandardSchema(schema);
  return Object.assign(standard, { toJSONSchema: (): JSONSchema => schema });
}
