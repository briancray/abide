// 54.1 — THE RUNG A HANDLER ANY MEMBER MAY CALL NAMES. A server's rung: it is filed in a handler's
// `middleware` or the per-request lane, and both run on the server.

import type { Failed } from '#shared/Failed.ts'
import type { Middleware } from '#shared/Middleware.ts'
import { principal } from '#shared/principal.ts'
import { refuse } from '#shared/refuse.ts'

/** 54.1 — the refusal every guard answers a caller nobody signed in as. */
export const signedOut = refuse.named('SignedOut', {
    status: 401,
    message: 'Sign in first.',
})

/** 54.1 — a rung admitting a caller the server authenticated, and refusing anyone else `SignedOut`. */
export const signedIn: Middleware<
    never,
    object,
    Failed<'SignedOut', undefined>
> = async (next) => ((await principal.authenticated) ? next() : signedOut())
