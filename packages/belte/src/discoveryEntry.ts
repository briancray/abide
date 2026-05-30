// @ts-expect-error virtual module resolved by belteResolverPlugin
import { rpc } from './_virtual/rpc.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { sockets } from './_virtual/sockets.ts'
import { verbRegistry } from './lib/server/rpc/verbRegistry.ts'
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

const manifest = Object.fromEntries(
    Array.from(verbRegistry.values())
        .filter((entry) => entry.clients.cli)
        .map((entry) => [
            commandNameForUrl(entry.remote.url),
            {
                method: entry.remote.method,
                url: entry.remote.url,
                jsonSchema: jsonSchemaForSchema(entry.schema, entry.jsonSchema),
            },
        ]),
)

process.stdout.write(JSON.stringify(manifest))
