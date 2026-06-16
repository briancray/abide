// @ts-expect-error virtual module resolved by abideResolverPlugin
import { rpc } from './_virtual/rpc.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { sockets } from './_virtual/sockets.ts'
import type { CliManifestEntry } from './lib/cli/types/CliManifestEntry.ts'
import { verbRegistry } from './lib/server/rpc/verbRegistry.ts'
import { socketOperations } from './lib/server/sockets/socketOperations.ts'
import { socketRegistry } from './lib/server/sockets/socketRegistry.ts'
import { commandNameForUrl } from './lib/shared/commandNameForUrl.ts'
import { jsonSchemaForSchema } from './lib/shared/jsonSchemaForSchema.ts'

/*
One-shot script that imports every rpc + socket module so defineVerb /
defineSocket populate the process-wide registries, then prints the CLI
manifest to stdout as JSON. Used by buildCli to bake the manifest into
the standalone binary at build time without resorting to static source
parsing (which can't see toJsonSchema()/toJSONSchema() at compile time).
*/
await Promise.all([
    ...Object.values(rpc).map((loader) => (loader as () => Promise<unknown>)()),
    ...Object.values(sockets).map((loader) => (loader as () => Promise<unknown>)()),
])

const manifest: Record<string, CliManifestEntry> = {}

for (const entry of verbRegistry.values()) {
    if (!entry.clients.cli) {
        continue
    }
    manifest[commandNameForUrl(entry.remote.url)] = {
        method: entry.remote.method,
        url: entry.remote.url,
        jsonSchema: jsonSchemaForSchema(entry.inputSchema),
    }
}

/*
Sockets advertised to the CLI become commands against the socket's HTTP
face (see socketOperations): `<base>-tail` streams live (GET +
text/event-stream, with an optional --tail N to seed from the retained
tail first) and, when clientPublish is set, `<base>-publish` sends the args bag
as a message (POST).
*/
for (const entry of socketRegistry.values()) {
    if (!entry.clients.cli) {
        continue
    }
    for (const operation of socketOperations(entry)) {
        if (operation.kind === 'tail') {
            manifest[operation.name] = {
                method: operation.method,
                url: operation.restUrl,
                accept: 'text/event-stream',
                jsonSchema: {
                    type: 'object',
                    description: `tail the "${operation.socketName}" socket`,
                    properties: {
                        tail: {
                            type: 'number',
                            description: 'replay last N messages before tailing live',
                        },
                    },
                },
            }
            continue
        }
        const payloadSchema = jsonSchemaForSchema(entry.schema)
        manifest[operation.name] = {
            method: operation.method,
            url: operation.restUrl,
            jsonSchema: {
                ...payloadSchema,
                description:
                    (payloadSchema.description as string | undefined) ??
                    `publish a message to the "${operation.socketName}" socket`,
            },
        }
    }
}

process.stdout.write(JSON.stringify(manifest))
