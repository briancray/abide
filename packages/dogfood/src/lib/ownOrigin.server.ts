import { request, server } from '@abide/abide/server'

/**
 * The origin a request this app makes of itself is aimed at: the socket it listens on, never the
 * origin a request names, which a `Host` header makes anyone's — save under `abide dev`, which binds
 * none (42.9).
 */
export function ownOrigin(): string {
    try {
        return server().url.origin
    } catch {
        return new URL(request().url).origin
    }
}
