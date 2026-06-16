import { commandNameForUrl } from '../../shared/commandNameForUrl.ts'
import { SOCKETS_PATH } from '../../shared/SOCKETS_PATH.ts'
import type { SocketOperation } from './types/SocketOperation.ts'
import type { SocketRegistryEntry } from './types/SocketRegistryEntry.ts'

/*
Projects a socket registry entry into the operations it exposes to the
CLI and MCP. Single source for the naming convention (`<base>-tail` /
`<base>-publish`), the existence rule (tail always; publish only when the
socket allows client publishing), and each operation's HTTP face — so the
CLI manifest builder, the MCP tool list, and the MCP tool dispatcher can't
disagree about which operations a socket has or what they're called.
*/
export function socketOperations(entry: SocketRegistryEntry): SocketOperation[] {
    const base = commandNameForUrl(entry.socket.name)
    const restUrl = `${SOCKETS_PATH}/${entry.socket.name}`
    const operations: SocketOperation[] = [
        {
            kind: 'tail',
            name: `${base}-tail`,
            socketName: entry.socket.name,
            restUrl,
            method: 'GET',
        },
    ]
    if (entry.allowClientPublish) {
        operations.push({
            kind: 'publish',
            name: `${base}-publish`,
            socketName: entry.socket.name,
            restUrl,
            method: 'POST',
        })
    }
    return operations
}
