import { cookies } from '#shared/cookies.ts'
import { randomToken } from './randomToken.ts'
import {
    currentRequestScope,
    type RequestScope,
    within,
} from './requestScope.ts'

// 26.5 AND 26.19 — WHICH BROWSER, as against who is using it: read off the `abide-caller` cookie, or
// minted where there is none. What the seed buffer is keyed by (41.18), and what `principal.caller`
// reads.
//
// MINTED ON A PAGE ALONE. A page is where a browser starts, and the one answer a later call has to be
// matched back to; a machine calling a handler directly has no render to be matched to and is not
// handed a cookie it never asked for.

// 26.19.
const CALLER_COOKIE = 'abide-caller'

/**
 * `principal.caller` as it stands in this request, or `undefined`; never minted.
 *
 * 41.18 — a caller rotated by a `principal.clear` earlier in it (26.7, 26.9) is the one a seed is
 * matched by, not the cookie the request arrived with — or a render made for the signed-in caller
 * answers the signed-out one.
 */
export function callerOf(): string | undefined {
    const scope = currentRequestScope()
    if (scope === undefined) return undefined
    if (scope.caller !== undefined) return scope.caller
    const header = scope.request?.headers.get('cookie') ?? null
    if (header === null) return undefined
    const given = new Bun.CookieMap(header).get(CALLER_COOKIE) ?? undefined
    scope.caller = given
    return given
}

/**
 * This request's caller, minting one where the request has none.
 *
 * 26.5, 26.6 — READ OFF ITS OWN COOKIE OR MINTED, and untouched by a sign-in.
 */
export function callerOrMint(): string {
    const scope = within('principal.caller')
    return callerOf() ?? mintCaller(scope)
}

/**
 * Mints a fresh caller for this request, sets its cookie, and returns it.
 *
 * Written through the request's jar as 26.12 writes the principal cookie: out of reach of the
 * page's own script, sent on a navigation from elsewhere, and only over https in production.
 */
export function mintCaller(scope: RequestScope): string {
    const caller = randomToken(16, 'base64url')
    // 22.10 — minted once the headers are out, it is this scope's alone: there is no answer to set it on.
    if (!scope.applied) cookies().set(CALLER_COOKIE, caller, { httpOnly: true })
    scope.caller = caller
    return caller
}
