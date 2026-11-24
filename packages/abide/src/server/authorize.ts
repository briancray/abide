// 54.2-54.4, 54.28 — THE RUNG A HANDLER NAMES FOR WHO MAY CALL IT. A server's rung: it is filed in a
// handler's `middleware` or the per-request lane, and both run on the server.

import type { Failed } from '#shared/Failed.ts'
import type { Middleware } from '#shared/Middleware.ts'
import { type Principal, principal } from '#shared/principal.ts'
import { refuse } from '#shared/refuse.ts'

import { currentRequestScope } from './requestScope.ts'
import { signedOut } from './signedIn.ts'

type Admits =
    Partial<Principal> | ((principal: Principal) => boolean | Promise<boolean>)

type SignedOut = Failed<'SignedOut', undefined>

/**
 * A rung admitting a signed-in caller whose `principal.resolved` holds `admits`, or whom `admits`
 * passes where it is a function, and answering anyone else as an address nothing serves: 54.2, 54.3,
 * 54.28.
 */
export function authorize(
    admits: Admits,
    options: {
        /** 403, the default, refuses `Forbidden`; 404 answers as an address nothing serves (54.28). */
        status: 404
    },
): Middleware<
    never,
    object,
    SignedOut | Failed<'NotFound', { path: string; method: string }>
>
/**
 * A rung admitting a signed-in caller whose `principal.resolved` holds `admits`, or whom `admits`
 * passes where it is a function, and refusing anyone else `Forbidden`: 54.2, 54.3, 54.4.
 */
export function authorize(
    admits: Admits,
    options?: {
        /** What the `Forbidden` refusal says. */
        message?: string
        /** 403, the default, refuses `Forbidden`; 404 answers as an address nothing serves (54.28). */
        status?: 403
    },
): Middleware<never, object, SignedOut | Failed<'Forbidden', undefined>>
export function authorize(
    admits: Admits,
    options: { message?: string; status?: 403 | 404 } = {},
): Middleware<
    never,
    object,
    | SignedOut
    | Failed<'Forbidden', undefined>
    | Failed<'NotFound', { path: string; method: string }>
> {
    const refused =
        options.status === 404
            ? hidden
            : refuse.named('Forbidden', 403, options.message)
    const passes =
        typeof admits === 'function'
            ? admits
            : (resolved: Principal) => holds(resolved, admits)
    return async (next) => {
        const resolved = await principal.resolved
        if (!resolved.authenticated) return signedOut()
        return (await passes(resolved)) ? next() : refused()
    }
}

// 54.3 — an object holds every member `wanted` names as `wanted` holds it, an array holds every item
// `wanted` lists in any order beside any others, and anything else is the same value.
function holds(held: unknown, wanted: unknown): boolean {
    if (Array.isArray(wanted)) {
        if (!Array.isArray(held)) return false
        for (const item of wanted)
            if (!held.some((candidate) => holds(candidate, item))) return false
        return true
    }
    if (typeof wanted === 'object' && wanted !== null) {
        if (typeof held !== 'object' || held === null) return false
        for (const key in wanted)
            if (
                !holds(
                    (held as Record<string, unknown>)[key],
                    (wanted as Record<string, unknown>)[key],
                )
            )
                return false
        return true
    }
    return held === wanted
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
