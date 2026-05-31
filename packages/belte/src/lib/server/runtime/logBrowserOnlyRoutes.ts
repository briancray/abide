import { commandNameForUrl } from '../../shared/commandNameForUrl.ts'
import { log } from '../../shared/log.ts'
import { verbRegistry } from '../rpc/verbRegistry.ts'
import { socketRegistry } from '../sockets/socketRegistry.ts'
import { ensureRegistriesLoaded } from './registryManifests.ts'

/*
Surfaces the otherwise-silent consequence of belte's multimodal-by-default
rule: a verb or socket with no schema never reaches MCP or the CLI, since
the schema is what makes those surfaces safe to advertise. Loads the full
registry, then logs (once at boot, only when `belte` debug logging is on
so it doesn't force eager imports in production) the routes that stay
browser-only purely for lack of a schema — so the missing matrix cells
are visible rather than surprising. Best-effort: enumeration failures are
swallowed since this is diagnostic only.
*/
export async function logBrowserOnlyRoutes(): Promise<void> {
    try {
        await ensureRegistriesLoaded()
    } catch {
        return
    }
    const names: string[] = []
    for (const entry of verbRegistry.values()) {
        if (
            entry.clients.browser &&
            !entry.clients.mcp &&
            !entry.clients.cli &&
            !entry.inputSchema
        ) {
            names.push(commandNameForUrl(entry.remote.url))
        }
    }
    for (const entry of socketRegistry.values()) {
        if (entry.clients.browser && !entry.clients.mcp && !entry.clients.cli && !entry.schema) {
            names.push(entry.socket.name)
        }
    }
    if (names.length > 0) {
        log.detail(
            `browser-only (no schema → not on MCP/CLI): ${names.sort().join(', ')} — add a schema to expose them`,
        )
    }
}
