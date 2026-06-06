import { commandNameForUrl } from '../../shared/commandNameForUrl.ts'
import { log } from '../../shared/log.ts'
import { verbRegistry } from '../rpc/verbRegistry.ts'
import { socketRegistry } from '../sockets/socketRegistry.ts'
import { ensureRegistriesLoaded } from './registryManifests.ts'

/*
Boot-time surface map: every rpc and socket with the exact set of client
surfaces it is exposed on, so belte's multimodal-by-default rule is auditable
rather than implicit. You can see at a glance that `getProduct` is live as an
MCP tool and a CLI command while `createOrder` stays http/browser-only for
lack of a schema. http + openapi are unconditional for every rpc; browser,
mcp, and cli are per-declaration (the schema is what makes the non-browser
surfaces safe to advertise — see defineVerb). Loads the full registry, so it
runs once at boot and only when `belte` debug logging is on (DEBUG=belte) to
avoid forcing eager imports in production. Best-effort: enumeration failures
are swallowed, this is diagnostic only.
*/
export async function logExposedSurfaces(): Promise<void> {
    try {
        await ensureRegistriesLoaded()
    } catch {
        return
    }
    const verbLines = Array.from(verbRegistry.values(), (entry) => {
        const name = commandNameForUrl(entry.remote.url)
        const surfaces = [
            'http',
            'openapi',
            entry.clients.browser ? 'browser' : undefined,
            entry.clients.mcp ? `mcp:${name}` : undefined,
            entry.clients.cli ? `cli:${name}` : undefined,
        ].filter((surface) => surface !== undefined)
        const missingMachineSurface = !entry.clients.mcp || !entry.clients.cli
        const hint = !entry.inputSchema && missingMachineSurface ? '  (add a schema → mcp/cli)' : ''
        return `  ${entry.remote.method.padEnd(6)} ${entry.remote.url} → ${surfaces.join(', ')}${hint}`
    })
    const socketLines = Array.from(socketRegistry.values(), (entry) => {
        const surfaces = [
            'socket',
            entry.clients.mcp ? 'mcp' : undefined,
            entry.clients.cli ? 'cli' : undefined,
        ].filter((surface) => surface !== undefined)
        return `  SOCKET ${entry.socket.name} → ${surfaces.join(', ')}`
    })
    const lines = [...verbLines, ...socketLines].sort()
    if (lines.length > 0) {
        log.info('exposed surfaces:')
        log.detail(lines.join('\n'))
    }
}
