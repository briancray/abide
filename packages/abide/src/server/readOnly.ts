import type { Failed } from '#shared/Failed.ts'
import type { Middleware } from '#shared/Middleware.ts'
import { refuse } from '#shared/refuse.ts'
import { url } from '#shared/url.ts'

// RFC 9110's safe methods: a read, which 54.5 never refuses.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * A rung refusing every write but one to a handler `allow` lists: 54.5, 54.6. Filed with
 * `middleware(...)` it closes every route below its file to writes; in a handler's `middleware`
 * option, that handler alone.
 */
export function readOnly(
    options: {
        /** The handlers whose writes stay open, each matched by its `rpc.address`. */
        allow?: readonly { address: string | undefined }[]
        /** What the `ReadOnly` refusal says, in place of the default. */
        message?: string
    } = {},
): Middleware<never, object, Failed<'ReadOnly', undefined>> {
    const refused = refuse.named(
        'ReadOnly',
        403,
        options.message ?? 'This copy takes no changes.',
    )
    const allowed = options.allow ?? []
    return (next, { request }) => {
        if (SAFE_METHODS.has(request.method)) return next()
        if (allowed.length > 0) {
            // 37.20 — the lane hands the path below the mount, and an address carries the mount.
            const path = url('/').slice(0, -1) + new URL(request.url).pathname
            for (const handler of allowed)
                if (handler.address === path) return next()
        }
        return refused()
    }
}
