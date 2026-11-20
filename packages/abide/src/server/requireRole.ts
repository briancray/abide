import type { Failed } from '#shared/Failed.ts'
import type { Middleware } from '#shared/Middleware.ts'
import { type Principal, principal } from '#shared/principal.ts'
import { refuse } from '#shared/refuse.ts'

import { currentRequestScope } from './requestScope.ts'
import { signedOut } from './signedIn.ts'

type Role = string | ((principal: Principal) => boolean | Promise<boolean>)

/**
 * A rung admitting a signed-in caller whose `principal.resolved` carries `role`, or whom `role`
 * passes where it is a function: 54.2, 54.3, 54.4, 54.28.
 */
export function requireRole(
    role: Role,
    options: {
        /** What the `Forbidden` refusal says, in place of one naming the role. */
        message?: string
        /** 403, the default, refuses `Forbidden`; 404 answers as an address nothing serves (54.28). */
        status: 404
    },
): Middleware<
    never,
    object,
    | Failed<'SignedOut', undefined>
    | Failed<'NotFound', { path: string; method: string }>
>
export function requireRole(
    role: Role,
    options?: {
        /** What the `Forbidden` refusal says, in place of one naming the role. */
        message?: string
        /** 403, the default, refuses `Forbidden`; 404 answers as an address nothing serves (54.28). */
        status?: 403
    },
): Middleware<
    never,
    object,
    Failed<'SignedOut', undefined> | Failed<'Forbidden', undefined>
>
export function requireRole(
    role: Role,
    options: { message?: string; status?: 403 | 404 } = {},
): Middleware<
    never,
    object,
    | Failed<'SignedOut', undefined>
    | Failed<'Forbidden', undefined>
    | Failed<'NotFound', { path: string; method: string }>
> {
    const forbidden = refuse.named(
        'Forbidden',
        403,
        options.message ??
            (typeof role === 'string'
                ? `Only ${role}s may do this.`
                : undefined),
    )
    const refused = options.status === 404 ? hidden : forbidden
    const admits =
        typeof role === 'string'
            ? (resolved: Principal) => resolved.role === role
            : role
    return async (next) => {
        const resolved = await principal.resolved
        if (!resolved.authenticated) return signedOut()
        return (await admits(resolved)) ? next() : refused()
    }
}

// 54.28 — the refusal 15.7 answers an address nothing serves, word for word, so the two cannot be
// told apart: its path is the one routing reads, below the mount, and not the one bun received. An
// in-process call has no request, and names no path.
function hidden(): Failed<'NotFound', { path: string; method: string }> {
    const asked = currentRequestScope()?.request
    return refuse.notFound({
        path: asked === undefined ? '' : new URL(asked.url).pathname,
        method: asked?.method ?? '',
    })
}
