import { abideLog } from '../../shared/abideLog.ts'
import { rpcRegistry } from '../rpc/rpcRegistry.ts'
import { socketRegistry } from '../sockets/socketRegistry.ts'
import { ensureRegistriesLoaded } from './registryManifests.ts'

/*
Boot-time disclosure for an unguarded MCP endpoint: when /__abide/mcp is
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
    /* Rpc entries carry the resolved clients on `entry.remote` (ADR-0020); socket entries
       keep their own `entry.clients`. Count each from its own home. */
    let exposed = 0
    for (const entry of rpcRegistry.values()) {
        if (entry.remote.clients.mcp) {
            exposed += 1
        }
    }
    for (const entry of socketRegistry.values()) {
        if (entry.clients.mcp) {
            exposed += 1
        }
    }
    if (exposed === 0) {
        return
    }
    abideLog.warn(
        `MCP endpoint /__abide/mcp exposes ${exposed} declaration${exposed === 1 ? '' : 's'} ` +
            'with no auth guard — add an app.handle middleware in src/app.ts to ' +
            'authenticate machine clients, or set clients.mcp: false per declaration',
    )
}
