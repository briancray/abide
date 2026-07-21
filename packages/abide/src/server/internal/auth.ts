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
import { seal, ttlMs, unseal } from './seal.ts'

const APP_OWNER: Principal = { id: 'app-owner', authenticated: true, appOwner: true }

export function isProd(): boolean {
    return Bun.env.NODE_ENV === 'production'
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

export async function resolveIdentity(request: Request): Promise<Principal> {
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
                return appOwner()
            }
            const unsealed = await unseal(bearer)
            if (unsealed !== undefined) return unsealed
        }
    }

    const cookies = new Bun.CookieMap(request.headers.get('cookie') ?? '')
    const cookieToken = cookies.get('abide-identity')
    if (cookieToken !== null && cookieToken.length > 0) {
        const unsealed = await unseal(cookieToken)
        if (unsealed !== undefined) return unsealed
    }

    return anonymousPrincipal()
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
