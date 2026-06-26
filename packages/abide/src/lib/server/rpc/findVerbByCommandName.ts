import { commandNameForUrl } from '../../shared/commandNameForUrl.ts'
import { rpcRegistry } from './rpcRegistry.ts'
import type { VerbRegistryEntry } from './types/VerbRegistryEntry.ts'

/*
Finds the registered verb whose URL maps to a given command name (folder
segments joined with `-`, per commandNameForUrl). The CLI client proxy and
the MCP tool dispatcher both key off this name, so the scan lives here once
rather than being re-implemented — and reused — at each call site.
*/
export function findVerbByCommandName(name: string): VerbRegistryEntry | undefined {
    for (const entry of rpcRegistry.values()) {
        if (commandNameForUrl(entry.remote.url) === name) {
            return entry
        }
    }
    return undefined
}
