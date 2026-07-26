// IDENTITY RESOLUTION — auth.md AU6/AU9. Turns an incoming Request into a Principal by walking
// the built-in bearer/cookie ladder BEFORE any app middleware runs. This resolves *who the
// caller is*; whether they may proceed is app middleware (AU7), never a per-surface default.
//
// Ladder (AU9.4):
//   1. Authorization: Bearer <t> — if t === ABIDE_APP_TOKEN (constant-time) → app-owner; else
//      unseal <t> as a sealed identity → that user's principal.
//   2. else the `abide-identity` cookie → unseal → that principal.
//   3. else a fresh, untracked anonymous principal.
//
// Cookie helpers here mint the auto-managed, encrypted `abide-identity` cookie (AU5): HttpOnly +
// SameSite=Lax (AU8 CSRF) + Path=/ + rolling Max-Age, Secure in prod.

import { anonymousPrincipal, type Principal } from './scope.ts'
import { seal, ttlMs, unseal, unsealPayload } from './seal.ts'

const APP_OWNER: Principal = { id: 'app-owner', authenticated: true, appOwner: true }

// The single production gate — drives the `Secure` cookie flag, HSTS, and the authenticated
// `identity.set()` secret fail-fast (AU5.3). Case/whitespace-insensitive ON PURPOSE: a `Production` /
// `PRODUCTION ` misconfiguration must still enable the prod security posture (fail-SAFE) rather than
// silently degrade it. An unset NODE_ENV is development, per the Node convention. A set-but-unrecognized
// value (`prod`, `staging`) is treated as non-production and warned once at boot — see `createApp`.
export function isProd(): boolean {
    return (Bun.env.NODE_ENV ?? '').trim().toLowerCase() === 'production'
}

// A NODE_ENV value that is set but is not one of the recognized modes — the case that silently relaxes
// the security posture and therefore warrants a loud boot warning. `undefined`/empty (→ development) is
// conventional and not flagged.
export function unrecognizedNodeEnv(): string | undefined {
    const raw = Bun.env.NODE_ENV
    if (raw === undefined || raw.length === 0) return undefined
    const normalized = raw.trim().toLowerCase()
    if (normalized === 'production' || normalized === 'development' || normalized === 'test')
        return undefined
    return raw
}

// Constant-time string comparison — avoids leaking how much of ABIDE_APP_TOKEN matched via
// timing. Length is compared up front (an unavoidable, low-value leak).
function constantTimeEqual(a: string, b: string): boolean {
    const left = new TextEncoder().encode(a)
    const right = new TextEncoder().encode(b)
    if (left.length !== right.length) return false
    let difference = 0
    for (const [i, leftByte] of left.entries()) {
        const rightByte = right[i]
        if (rightByte === undefined) throw new Error('constantTimeEqual: index out of range')
        difference |= leftByte ^ rightByte
    }
    return difference === 0
}

function appOwner(): Principal {
    return { ...APP_OWNER }
}

// `parsedCookies` lets a caller that has ALREADY parsed the request's cookie header hand it over — the
// router builds one `CookieMap` for the request scope, so without this the header is parsed twice per
// request. Omitted (tests, the socket-upgrade path) → parsed on demand, and only on the cookie rung.
export async function resolveIdentity(
    request: Request,
    parsedCookies?: Bun.CookieMap,
): Promise<Principal> {
    return (await resolveIdentityDetailed(request, parsedCookies)).principal
}

export interface ResolvedIdentity {
    principal: Principal
    // The `exp` (ms epoch) of the abide-identity COOKIE this principal came from, when it came from
    // one. Undefined for every other rung — a bearer, an absent/tampered/expired cookie, or the
    // anonymous fallback — all of which mean "no live cookie to roll", so the router must write one.
    cookieExpiresAt: number | undefined
}

// `resolveIdentity` plus the cookie expiry the router needs to decide whether the rolling cookie is
// due for a rewrite. Same ladder, same order; only the extra return field differs.
export async function resolveIdentityDetailed(
    request: Request,
    parsedCookies?: Bun.CookieMap,
): Promise<ResolvedIdentity> {
    const authorization = request.headers.get('authorization')
    if (authorization !== null) {
        const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
        if (match !== null) {
            const bearer = match[1]
            if (bearer === undefined) throw new Error('resolveIdentity: bearer capture missing')
            const appToken = Bun.env.ABIDE_APP_TOKEN
            if (
                appToken !== undefined &&
                appToken.length > 0 &&
                constantTimeEqual(bearer, appToken)
            ) {
                return { principal: appOwner(), cookieExpiresAt: undefined }
            }
            // A bearer is stateless (AU6.3) and never persists a cookie, so its `exp` is irrelevant.
            const unsealed = await unseal(bearer)
            if (unsealed !== undefined) return { principal: unsealed, cookieExpiresAt: undefined }
        }
    }

    const cookieToken = (
        parsedCookies ?? new Bun.CookieMap(request.headers.get('cookie') ?? '')
    ).get('abide-identity')
    if (cookieToken !== null && cookieToken.length > 0) {
        const payload = await unsealPayload(cookieToken)
        if (payload !== undefined) return { principal: payload.p, cookieExpiresAt: payload.exp }
    }

    return { principal: anonymousPrincipal(), cookieExpiresAt: undefined }
}

// How much of a cookie's lifetime may burn down before the rolling rewrite is worth an AES-GCM seal.
// At the 30-day default that is a rewrite at most once every three days per client — the session still
// rolls forward indefinitely for an active caller, which is the whole point of "rolling", while a busy
// client stops paying the seal on every single response.
const ROLL_AFTER_FRACTION = 0.1

// Should this response carry a freshly-sealed abide-identity cookie? `expiresAt` is the live cookie's
// expiry (undefined = there is no readable cookie, so one must be written).
export function identityCookieIsDue(expiresAt: number | undefined, now = Date.now()): boolean {
    if (expiresAt === undefined) return true
    const remaining = expiresAt - now
    if (remaining <= 0) return true
    return remaining < ttlMs() * (1 - ROLL_AFTER_FRACTION)
}

// Guard the identity accessor calls before persisting an authenticated principal: in prod,
// refuse to seal an authenticated identity without ABIDE_IDENTITY_SECRET, matching CO1 fail-fast
// (AU5.3) — no fail-open forgeable identity that resets every boot. Anonymous tracking may still
// ride the ephemeral key.
export function requireSecretForAuthedSet(authenticated: boolean): void {
    if (!authenticated) return
    if (!isProd()) return
    const secret = Bun.env.ABIDE_IDENTITY_SECRET
    if (secret === undefined || secret.length === 0) {
        throw new Error(
            'abide: cannot set an authenticated identity in production without ABIDE_IDENTITY_SECRET — an ephemeral key would produce a forgeable identity that resets on every restart. Set ABIDE_IDENTITY_SECRET.',
        )
    }
}

export async function identityCookieHeader(principal: Principal): Promise<string> {
    const value = await seal(principal)
    const maxAgeSeconds = Math.floor(ttlMs() / 1000)
    const attributes = [
        `abide-identity=${value}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        `Max-Age=${maxAgeSeconds}`,
    ]
    if (isProd()) attributes.push('Secure')
    return attributes.join('; ')
}

export function clearIdentityCookieHeader(): string {
    const attributes = ['abide-identity=', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0']
    if (isProd()) attributes.push('Secure')
    return attributes.join('; ')
}
