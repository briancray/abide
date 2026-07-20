// OUTPUT-SHAPING (rpc-core §5.2) — trim an RPC/hydration value to the fields its output schema
// declares, so a handler that over-returns (e.g. a full user row carrying `passwordHash`) never
// leaks undeclared fields onto the wire or into the hydration seed. Applied in ALL environments,
// not just dev.
//
// Shaping is a pure recursive key-pick against the emitted JSON Schema subset (jsonSchema.ts):
//   - object with `properties` → keep only declared keys (recurse each); undeclared keys dropped
//     UNLESS `additionalProperties` is `true`/an object (then extra keys are kept/recursed).
//   - array with `items` → shape each element.
//   - anything else (permissive `{}`, bare `type`, combinators, absent schema) → pass through
//     UNCHANGED. Truncating a value we cannot fully describe would be worse than over-returning, so
//     shaping only ever removes fields it is certain are undeclared.

import type { StandardSchemaV1 } from "../StandardSchema.ts";
import type { JSONSchema } from "./jsonSchema.ts";

// The JSON Schema keywords abide emits. A value carrying any of these (and NOT a `~standard` marker)
// is a raw/derived JSON Schema we can shape against; a Standard Schema (Zod/Valibot/etc.) is opaque
// here — its field set isn't available without type-derivation — so it yields undefined (no shaping).
const JSON_SCHEMA_KEYWORDS = ["type", "properties", "anyOf", "oneOf", "allOf", "enum", "const", "items"];

// Return the value as a shapeable JSONSchema, or undefined when it is a Standard Schema / not a
// schema at all (both cases: pass the value through unshaped).
export function jsonSchemaOf(schema: StandardSchemaV1 | JSONSchema | undefined): JSONSchema | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  if ("~standard" in schema) return undefined;
  for (const keyword of JSON_SCHEMA_KEYWORDS) {
    if (keyword in schema) return schema as JSONSchema;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Trim `value` to the fields `schema` declares. `schema === undefined` (or any non-shapeable schema)
// returns `value` unchanged.
export function shapeToSchema(value: unknown, schema: JSONSchema | undefined): unknown {
  if (schema === undefined || value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    if (schema.items === undefined) return value;
    const items = schema.items;
    const shaped: unknown[] = new Array(value.length);
    for (let index = 0; index < value.length; index++) {
      shaped[index] = shapeToSchema(value[index], items);
    }
    return shaped;
  }

  if (isPlainObject(value)) {
    const properties = schema.properties;
    if (properties === undefined) return value; // permissive object schema — cannot enumerate fields
    const additional = schema.additionalProperties;
    const shaped: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const declared = properties[key];
      if (declared !== undefined) {
        shaped[key] = shapeToSchema(value[key], declared);
      } else if (additional === true) {
        shaped[key] = value[key];
      } else if (typeof additional === "object" && additional !== null) {
        shaped[key] = shapeToSchema(value[key], additional as JSONSchema);
      }
      // else: undeclared key with no additionalProperties allowance — dropped.
    }
    return shaped;
  }

  return value;
}
