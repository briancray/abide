import type { Failed } from '#shared/Failed.ts'
import type { Middleware } from '#shared/Middleware.ts'
import { type Principal, principal } from '#shared/principal.ts'
import { refuse } from '#shared/refuse.ts'

import { signedOut } from './signedIn.ts'

/**
 * A rung admitting a signed-in caller whose `principal.resolved` carries `role`, or whom `role`
 * passes where it is a function: 54.2, 54.3, 54.4.
 */
export function requireRole(
    role: string | ((principal: Principal) => boolean | Promise<boolean>),
    options: {
        /** What the `Forbidden` refusal says, in place of one naming the role. */
        message?: string
    } = {},
): Middleware<
    never,
    object,
    Failed<'SignedOut', undefined> | Failed<'Forbidden', undefined>
> {
    const forbidden = refuse.named(
        'Forbidden',
        403,
        options.message ??
            (typeof role === 'string'
                ? `Only ${role}s may do this.`
                : undefined),
    )
    const admits =
        typeof role === 'string'
            ? (resolved: Principal) => resolved.role === role
            : role
    return async (next) => {
        const resolved = await principal.resolved
        if (!resolved.authenticated) return signedOut()
        return (await admits(resolved)) ? next() : forbidden()
    }
}
