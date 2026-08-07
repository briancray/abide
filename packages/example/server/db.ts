// Stands in for a database driver: server-only, and with a module-level SIDE EFFECT so that its
// absence from the browser bundle is a real result rather than something tree-shaking would have
// done anyway. A bundler may drop an unused pure export; it may not drop this.

export const SERVER_ONLY_MARKER = 'ABIDE_EXAMPLE_SERVER_ONLY_SECRET'

// The side effect: state built at import, which a bundler may not drop the way it may drop an unused
// pure export.
const NAMES = new Map<number, string>()

// One "connection", opened when this module loaded. A constant rather than a counter that only ever
// reaches one — nothing here opens a second, and the value exists to be read back over the wire.
const connections = 1

/**
 * The shape a handler answers with, declared where the data is rather than beside the endpoint.
 *
 * This is the ordinary place for it, and it is why the compiler follows an import to derive a shape:
 * an app of any size keeps its types next to its data, and an endpoint that could only publish what
 * was spelled inline would publish almost nothing.
 */
export interface User {
    id: number
    name: string
    connections: number
}

export function findUser(id: number): User {
    return { id, name: NAMES.get(id) ?? `user ${id}`, connections }
}

export function renameUser(id: number, name: string): { id: number; name: string } {
    NAMES.set(id, name)
    return { id, name }
}
