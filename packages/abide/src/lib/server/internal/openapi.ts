// OpenAPI 3.1 projection of the registry (machine-surfaces.md MS4). Every RPC whose
// `clients.browser` is not explicitly false becomes a path `/rpc/<name>` with the operation for
// its HTTP verb:
//   - GET/HEAD (reads): a single `args` query parameter carrying the encoded args object (§14.1),
//     typed by the input schema.
//   - POST/PUT/PATCH/DELETE (mutations): a JSON request body typed by the input schema.
// Every operation declares a 200 application/json response (output schema when known) and a 422
// ValidationError response (the shape the router returns on input-validation failure). Both
// abide auth mechanisms — bearer token and the `abide-identity` cookie — are declared as security
// schemes (MS4.2). Missing schemas project as a permissive `{}` (anything).

import type { Registry, RpcEntry } from "./registry.ts";
import type { JSONSchema } from "../../shared/internal/jsonSchema.ts";

export interface OpenApiOptions {
  title?: string;
  version?: string;
}

// A permissive schema — "any value" — used wherever the registry has no concrete JSON Schema.
function anySchema(): Record<string, unknown> {
  return {};
}

function schemaOrAny(schema: JSONSchema | undefined): Record<string, unknown> {
  return schema !== undefined ? (schema as Record<string, unknown>) : anySchema();
}

// The 422 body the router emits (ValidationErrorData: `{ issues, fields }`). Declared once under
// components/schemas and referenced from every operation's 422 response.
function validationErrorSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            message: { type: "string" },
            path: { type: "array" },
          },
        },
      },
      fields: { type: "object" },
    },
  };
}

function operationForRpc(entry: RpcEntry): Record<string, unknown> {
  const responses: Record<string, unknown> = {
    "200": {
      description: "Success",
      content: { "application/json": { schema: schemaOrAny(entry.outputSchema) } },
    },
    "422": {
      description: "Validation error",
      content: { "application/json": { schema: { $ref: "#/components/schemas/ValidationError" } } },
    },
  };

  const operation: Record<string, unknown> = {
    operationId: entry.name,
    responses,
  };
  if (entry.doc !== undefined) operation.summary = entry.doc;

  if (entry.read) {
    // §14.1: reads carry the args object encoded in a single `args` query parameter.
    operation.parameters = [
      {
        name: "args",
        in: "query",
        required: entry.inputSchema !== undefined,
        schema: schemaOrAny(entry.inputSchema),
      },
    ];
  } else {
    operation.requestBody = {
      required: true,
      content: { "application/json": { schema: schemaOrAny(entry.inputSchema) } },
    };
  }

  return operation;
}

export function buildOpenApi(registry: Registry, opts?: OpenApiOptions): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const entry of registry.rpcs) {
    // MS1.4: `browser: false` withholds the RPC from OpenAPI; absent/true exposes it.
    if (entry.clients.browser === false) continue;
    const path = `/rpc/${entry.name}`;
    const verb = entry.method.toLowerCase();
    const item = paths[path] ?? {};
    item[verb] = operationForRpc(entry);
    paths[path] = item;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: opts?.title ?? "abide app",
      version: opts?.version ?? "0.0.0",
    },
    paths,
    components: {
      schemas: {
        ValidationError: validationErrorSchema(),
      },
      securitySchemes: {
        // MS4.2: both bearer (per-user / app token) and the rolling identity cookie.
        bearerAuth: { type: "http", scheme: "bearer" },
        identityCookie: { type: "apiKey", in: "cookie", name: "abide-identity" },
      },
    },
  };
}
