import { belteLog } from '../../shared/belteLog.ts'
import { verbRegistry } from '../rpc/verbRegistry.ts'
import { socketRegistry } from '../sockets/socketRegistry.ts'
import { ensureRegistriesLoaded } from './registryManifests.ts'

/*
Boot-time disclosure for an unguarded MCP endpoint: when /__belte/mcp is
mounted with at least one MCP-exposed declaration and no app.handle
middleware to authenticate requests, say so. Printed unconditionally — the
surface map is DEBUG-gated diagnostics, but an unauthenticated machine
surface should never boot silently. The caller skips this entirely when
app.handle exists, so only the authless path pays the eager registry load.
Best-effort like the surface map: enumeration failures are swallowed.
*/
export async function warnUnguardedMcp(): Promise<void> {
    try {
        await ensureRegistriesLoaded()
    } catch {
        return
    }
    const exposed =
        Array.from(verbRegistry.values()).filter((entry) => entry.clients.mcp).length +
        Array.from(socketRegistry.values()).filter((entry) => entry.clients.mcp).length
    if (exposed === 0) {
        return
    }
    belteLog.warn(
        `MCP endpoint /__belte/mcp exposes ${exposed} declaration${exposed === 1 ? '' : 's'} ` +
            'with no auth guard — add an app.handle middleware in src/app.ts to ' +
            'authenticate machine clients, or set clients.mcp: false per declaration',
    )
}
