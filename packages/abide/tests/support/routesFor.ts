import type { SocketRoutes } from '../../src/lib/server/sockets/types/SocketRoutes.ts'

/* A socket loader map resolving each named socket — defineSocket already
   populated the registry, so each loader is a no-op resolve. */
export function routesFor(...names: string[]): SocketRoutes {
    return Object.fromEntries(
        names.map((name) => [name, () => Promise.resolve({})]),
    ) as unknown as SocketRoutes
}
