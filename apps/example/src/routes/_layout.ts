import type { ResolveHook } from 'belte/server'

export const resolve: ResolveHook = () => {
    return { data: { requestedAt: new Date().toISOString() } }
}
