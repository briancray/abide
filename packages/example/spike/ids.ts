// Where a handler lives IS what it is, and what it is addressed by.
//
// `server/rpc/**` is rpc and `server/sockets/**` is a socket, so the KIND is known from the path
// before the file is read — which is what lets one plugin emit two different stubs without scanning
// for which one to write.
//
// The id is the module's path under its directory plus the export name, and there is no hash: two
// endpoints can only collide if two files collide, and the filesystem already prevents that. The
// suffix form this replaced had to hash the whole repo-relative path, because a `*.server.ts` may
// live anywhere and two of them may share a name. Mandating the directory removed the ambiguity the
// hash existed to resolve, so the hash went with it — and an address is now legible in a network
// panel and a stack trace, which is worth more than the bytes it costs.

export const RPC_DIRECTORY = '/server/rpc/'
export const SOCKET_DIRECTORY = '/server/sockets/'

export type Kind = 'rpc' | 'socket'

/** Which transport a module declares, or `null` if it declares none. */
export function kindOf(modulePath: string): Kind | null {
    if (modulePath.includes(RPC_DIRECTORY)) return 'rpc'
    if (modulePath.includes(SOCKET_DIRECTORY)) return 'socket'
    return null
}

function under(modulePath: string, directory: string): string {
    const at = modulePath.lastIndexOf(directory)
    const rest = modulePath.slice(at + directory.length)
    return rest.endsWith('.ts') ? rest.slice(0, -3) : rest
}

/** `users/getUser` — the module under its transport directory, then the export. */
export function endpointId(modulePath: string, exportName: string): string {
    const kind = kindOf(modulePath)
    if (kind === null)
        throw new Error(`abide: ${modulePath} is not under ${RPC_DIRECTORY} or ${SOCKET_DIRECTORY}`)
    const directory = kind === 'rpc' ? RPC_DIRECTORY : SOCKET_DIRECTORY
    return `${under(modulePath, directory)}/${exportName}`
}
