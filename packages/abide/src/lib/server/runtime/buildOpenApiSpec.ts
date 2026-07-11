import { carriesBodyArgs } from '../../shared/carriesBodyArgs.ts'
import { commandNameForUrl } from '../../shared/commandNameForUrl.ts'
import { jsonSchemaForSchema } from '../../shared/jsonSchemaForSchema.ts'
import type { ErrorJsonSchemas } from '../../shared/types/ErrorJsonSchemas.ts'
import { resolveInputJsonSchema, resolveOutputJsonSchema } from '../rpc/resolveRpcJsonSchema.ts'
import { rpcRegistry } from '../rpc/rpcRegistry.ts'
import { STATUS_TEXT } from './STATUS_TEXT.ts'

/*
Turns a rpc's resolved JSON Schema into OpenAPI query parameters — one
per top-level property, marked required when the schema lists it. Used
for GET/DELETE/HEAD operations, which carry their args on the query
string (mirroring buildRpcRequest).
*/
function queryParameters(jsonSchema: Record<string, unknown>): Array<Record<string, unknown>> {
    const properties = jsonSchema.properties as Record<string, unknown> | undefined
    if (!properties) {
        return []
    }
    const required = new Set((jsonSchema.required as string[] | undefined) ?? [])
    return Object.entries(properties).map(([name, schema]) => ({
        name,
        in: 'query',
        required: required.has(name),
        schema,
    }))
}

/*
Request body schema for a multipart upload rpc: the text fields from
inputSchema, plus the binary parts. A File has no honest
Standard-Schema→JSON-Schema conversion, so the file parts are advertised
generically as additional binary properties rather than named per field.
*/
function multipartBodySchema(textSchema: Record<string, unknown>): Record<string, unknown> {
    const textProperties = (textSchema.properties as Record<string, unknown> | undefined) ?? {}
    const schema: Record<string, unknown> = {
        type: 'object',
        properties: { ...textProperties },
        additionalProperties: { type: 'string', format: 'binary' },
    }
    const required = (textSchema.required as string[] | undefined) ?? []
    if (required.length > 0) {
        schema.required = required
    }
    return schema
}

/*
Adds one `responses[status]` entry per typed-error branch (ADR-0030) — its description is the
status's standard reason phrase, and its `application/json` content is the error's projected `data`
schema (omitted for a bare `{}`, a nullary error with no payload). An already-present status (the
200, or any explicit response) is left untouched, so the success body and validation responses win a
collision. A no-op when the handler declared no typed errors (`errorJsonSchemas` undefined).
*/
function mergeErrorResponses(
    responses: Record<string, unknown>,
    errorJsonSchemas: ErrorJsonSchemas | undefined,
): void {
    if (errorJsonSchemas === undefined) {
        return
    }
    for (const [status, schema] of Object.entries(errorJsonSchemas)) {
        if (responses[status] !== undefined) {
            continue
        }
        const response: Record<string, unknown> = {
            description: STATUS_TEXT[Number(status)] ?? 'Error',
        }
        if (Object.keys(schema).length > 0) {
            response.content = { 'application/json': { schema } }
        }
        responses[status] = response
    }
}

/*
Builds an OpenAPI 3.1 document from the rpc registry — the HTTP surface
every rpc exposes regardless of which non-browser clients it advertises.
GET/DELETE/HEAD args become query parameters; POST/PUT/PATCH args become
a JSON request body. operationId is the folder-prefixed command name so
it lines up with the MCP tool / CLI subcommand identifiers.
*/
export function buildOpenApiSpec(info: {
    title: string
    version: string
}): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = {}
    for (const entry of rpcRegistry.values()) {
        const url = entry.remote.url
        const method = entry.remote.method
        /*
        Describe the parameters/request body from the `inputSchema` VALIDATOR when declared, else from
        the handler's input parameter type projected to JSON Schema at build time (ADR-0030 input side —
        `entry.inputJsonSchema`); otherwise the opaque fallback. The validator overrides the projection
        (a runtime narrowing the type can't express), mirroring the 200-body output path below.
        */
        const jsonSchema = resolveInputJsonSchema(entry) ?? jsonSchemaForSchema(undefined)
        const description = jsonSchema.description as string | undefined
        /*
        Describe the 200 body from the `outputSchema` VALIDATOR when declared, else from the handler
        return type projected to JSON Schema at build time (ADR-0030 D2 — `entry.outputJsonSchema`);
        otherwise fall back to a bare OK. The validator overrides the projection (a runtime narrowing
        the type can't express).
        */
        const okResponse: Record<string, unknown> = { description: 'OK' }
        const outputSchema = resolveOutputJsonSchema(entry)
        if (outputSchema) {
            okResponse.content = { 'application/json': { schema: outputSchema } }
        }
        /*
        Merge the handler's typed-error branches (ADR-0030 — `entry.errorJsonSchemas`, a status-keyed
        data-schema map baked from the `error.typed(...)` return branches) into the responses. Each
        status gets a `responses[status]` entry describing the error's data payload; an existing
        response (the 200, or a future explicit entry) is never clobbered. So the 200 success body and
        every typed error's status + payload are documented from the one handler return type.
        */
        const responses: Record<string, unknown> = { '200': okResponse }
        mergeErrorResponses(responses, entry.errorJsonSchemas)
        const operation: Record<string, unknown> = {
            operationId: commandNameForUrl(url),
            ...(description ? { description } : {}),
            responses,
        }
        if (carriesBodyArgs(method)) {
            operation.requestBody = entry.filesSchema
                ? {
                      content: {
                          'multipart/form-data': {
                              schema: multipartBodySchema(jsonSchema),
                          },
                      },
                  }
                : { content: { 'application/json': { schema: jsonSchema } } }
        } else {
            const parameters = queryParameters(jsonSchema)
            if (parameters.length > 0) {
                operation.parameters = parameters
            }
        }
        paths[url] ??= {}
        const path = paths[url]
        path[method.toLowerCase()] = operation
    }
    return {
        openapi: '3.1.0',
        info: { title: info.title, version: info.version },
        paths,
    }
}
