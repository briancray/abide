import type { ResolveHook } from 'belte/types/ResolveHook'

export const resolve: ResolveHook = () => {
    return { data: { requestedAt: new Date().toISOString() } }
}
