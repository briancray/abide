import { commandNameForUrl } from '../../shared/commandNameForUrl.ts'
import { jsonSchemaForSchema } from '../../shared/jsonSchemaForSchema.ts'
import type { HttpVerb } from '../rpc/types/HttpVerb.ts'
import { verbRegistry } from '../rpc/verbRegistry.ts'

const BODY_METHODS = new Set<HttpVerb>(['POST', 'PUT', 'PATCH'])

/*
Turns a verb's resolved JSON Schema into OpenAPI query parameters — one
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
Builds an OpenAPI 3.1 document from the verb registry — the HTTP surface
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
    for (const entry of verbRegistry.values()) {
        const url = entry.remote.url
        const method = entry.remote.method
        const jsonSchema = jsonSchemaForSchema(entry.schema, entry.jsonSchema)
        const operation: Record<string, unknown> = {
            operationId: commandNameForUrl(url),
            responses: { '200': { description: 'OK' } },
        }
        if (BODY_METHODS.has(method)) {
            operation.requestBody = {
                content: { 'application/json': { schema: jsonSchema } },
            }
        } else {
            const parameters = queryParameters(jsonSchema)
            if (parameters.length > 0) {
                operation.parameters = parameters
            }
        }
        const path = (paths[url] ??= {})
        path[method.toLowerCase()] = operation
    }
    return {
        openapi: '3.1.0',
        info: { title: info.title, version: info.version },
        paths,
    }
}
