// Stands in for a database driver: server-only, and with a module-level SIDE EFFECT so that its
// absence from the browser bundle is a real result rather than something tree-shaking would have
// done anyway. A bundler may drop an unused pure export; it may not drop this.

export const SERVER_ONLY_MARKER = 'ABIDE_SPIKE_SERVER_ONLY_SECRET'

let connections = 0
connections++

export function findUser(id: number): { id: number; name: string; connections: number } {
    return { id, name: `user ${id}`, connections }
}
