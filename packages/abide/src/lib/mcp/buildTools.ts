import { rpcRegistry } from '../server/rpc/rpcRegistry.ts'
import { socketOperations } from '../server/sockets/socketOperations.ts'
import { socketRegistry } from '../server/sockets/socketRegistry.ts'
import { commandNameForUrl } from '../shared/commandNameForUrl.ts'
import { jsonSchemaForSchema } from '../shared/jsonSchemaForSchema.ts'
import { annotationsForMethod } from './annotationsForMethod.ts'
import type { ToolDescriptor } from './types/ToolDescriptor.ts'

/*
Builds the array of MCP tool descriptors.

RPCs: every rpc with clients.mcp=true becomes one tool named after the
export's URL (folder segments joined with `-`). The HTTP method feeds the
tool's annotations (readOnlyHint / destructiveHint / idempotentHint) so
a model can tell a read from a write; reads auto-expose while mutating
rpcs require an explicit clients.mcp (see resolveClientFlags). When the
rpc declares an `outputSchema` it's advertised as the tool outputSchema.

Sockets: every socket with clients.mcp=true contributes a `<base>-tail`
read tool (recent buffered messages) and, when clientPublish is set, a
`<base>-publish` tool.
*/
export function buildTools(): ToolDescriptor[] {
    const tools: ToolDescriptor[] = []
    for (const entry of rpcRegistry.values()) {
        if (!entry.clients.mcp) {
            continue
        }
        /*
        Tool description favours the schema's top-level description (the
        vendor's JSON Schema conversion carries `.describe(...)` through),
        falling back to `method url` so the tool is still labelled when
        the schema has none.
        */
        const inputSchema = jsonSchemaForSchema(entry.inputSchema)
        const tool: ToolDescriptor = {
            name: commandNameForUrl(entry.remote.url),
            description:
                (inputSchema.description as string | undefined) ??
                `${entry.remote.method} ${entry.remote.url}`,
            inputSchema,
            annotations: annotationsForMethod(entry.remote.method),
        }
        if (entry.outputSchema) {
            tool.outputSchema = jsonSchemaForSchema(entry.outputSchema)
        }
        tools.push(tool)
    }
    for (const entry of socketRegistry.values()) {
        if (!entry.clients.mcp) {
            continue
        }
        const payloadSchema = jsonSchemaForSchema(entry.schema)
        for (const operation of socketOperations(entry)) {
            if (operation.kind === 'tail') {
                tools.push({
                    name: operation.name,
                    description: `Read recent messages from the "${operation.socketName}" socket`,
                    inputSchema: {
                        type: 'object',
                        properties: {
                            count: { type: 'number', description: 'max recent messages to return' },
                        },
                    },
                    outputSchema: {
                        type: 'object',
                        properties: { frames: { type: 'array', items: payloadSchema } },
                    },
                    annotations: { readOnlyHint: true, destructiveHint: false },
                })
                continue
            }
            tools.push({
                name: operation.name,
                description: `Publish a message to the "${operation.socketName}" socket`,
                inputSchema: payloadSchema,
                annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
            })
        }
    }
    return tools
}
