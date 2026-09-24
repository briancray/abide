// SECTION 26 — THE PRINCIPAL, RESOLVED ON A SERVER. The claims ride in a cookie the server sealed —
// an HMAC over the claims and their expiry, signed rather than encrypted (26.11) — so there is no
// store to look them up in and nothing to revoke (26.16). Resolved at most once per request (26.14),
// by `onPrincipal` where the app registered one, and the baseline is laid over what it answered (26.4).

import { cookies } from '#shared/cookies.ts'
import { isFailed } from '#shared/Failed.ts'
import { isRecord } from '#shared/isRecord.ts'
import { namedLogger } from '#shared/log.ts'
import {
    PRINCIPAL,
    type Principal,
    principalMembers,
} from '#shared/principal.ts'
import { refuse } from '#shared/refuse.ts'
import { callerOf, mintCaller } from './callerOf.ts'
import { config, positiveSetting } from './config.ts'
import { HOOKS } from './hooks.ts'
import { within } from './requestScope.ts'

// 26.18.
const PRINCIPAL_COOKIE = 'abide-principal'
// 26.20 — the ceiling a browser keeps one cookie under, name and attributes included.
const COOKIE_CEILING = 4096
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

const PRINCIPAL_LOG = namedLogger('abide:principal')

const ANONYMOUS: Principal = { authenticated: false }

function ttl(): number {
    return positiveSetting('ABIDE_PRINCIPAL_TTL', DEFAULT_TTL_MS)
}

// 36.5 — A LIST: the first secret signs, and every one verifies, so a secret can be rotated in.
function secrets(): string[] {
    const declared = config.peek()?.ABIDE_PRINCIPAL_SECRET
    if (typeof declared !== 'string') return []
    const listed: string[] = []
    for (const part of declared.split(','))
        if (part.trim() !== '') listed.push(part.trim())
    return listed
}

function signature(secret: string, payload: string): string {
    return new Bun.CryptoHasher('sha256', secret)
        .update(payload)
        .digest('base64url')
}

function seal(claims: unknown, expires: number, secret: string): string {
    const payload = Buffer.from(
        JSON.stringify({ c: claims, e: expires }),
    ).toString('base64url')
    return `${payload}.${signature(secret, payload)}`
}

// 26.13 — A BAD SIGNATURE, A LAPSED SEAL AND A MALFORMED COOKIE ARE ONE ANSWER: nothing.
function unseal(
    sealed: string | null,
): { claims: unknown; expires: number } | undefined {
    if (sealed === null) return undefined
    const at = sealed.lastIndexOf('.')
    if (at === -1) return undefined
    const payload = sealed.slice(0, at)
    const given = Buffer.from(sealed.slice(at + 1), 'base64url')
    let verified = false
    for (const secret of secrets()) {
        const expected = Buffer.from(signature(secret, payload), 'base64url')
        if (
            expected.length === given.length &&
            crypto.timingSafeEqual(expected, given)
        )
            verified = true
    }
    if (!verified) return undefined
    try {
        const opened = JSON.parse(
            Buffer.from(payload, 'base64url').toString(),
        ) as {
            c: unknown
            e: number
        }
        if (typeof opened.e !== 'number' || opened.e <= Date.now())
            return undefined
        return { claims: opened.c, expires: opened.e }
    } catch {
        return undefined
    }
}

function writeSeal(claims: unknown, expires: number): void {
    const [secret] = secrets()
    if (secret === undefined)
        throw new Error(
            'abide: principal.set needs ABIDE_PRINCIPAL_SECRET to seal the cookie with.',
        )
    const sealed = seal(claims, expires, secret)
    // 26.20.
    const bytes = PRINCIPAL_COOKIE.length + 1 + sealed.length
    if (bytes > COOKIE_CEILING)
        throw new Error(
            `abide: principal.set would write a ${bytes}-byte cookie, over the ${COOKIE_CEILING} bytes a browser keeps. Seal less in the claims.`,
        )
    // 26.12.
    cookies().set(PRINCIPAL_COOKIE, sealed, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: Math.floor((expires - Date.now()) / 1000),
    })
}

async function documentOf(
    claims: unknown,
    expires: number,
): Promise<Principal> {
    const baseline = {
        authenticated: true,
        expiresAt: new Date(expires).toISOString(),
        error: undefined,
    }
    const resolve = HOOKS.principal
    if (resolve === undefined)
        return { ...(isRecord(claims) ? claims : {}), ...baseline }
    try {
        const resolved = await resolve(claims)
        return { ...(isRecord(resolved) ? resolved : {}), ...baseline }
    } catch (thrown) {
        // 26.3 — a resolver that failed leaves the caller unauthenticated, and says why.
        PRINCIPAL_LOG.warning('onPrincipal threw', thrown)
        return {
            authenticated: false,
            expiresAt: undefined,
            error: isFailed(thrown)
                ? thrown
                : refuse(500, 'onPrincipal failed'),
        }
    }
}

// 26.14 — ONCE PER REQUEST, and 26.15 — a seal half spent is sealed again for another full life.
export function resolvePrincipal(): Promise<Principal> {
    const scope = within('principal')
    scope.principal ??= (async () => {
        const opened = unseal(cookies().get(PRINCIPAL_COOKIE))
        if (opened === undefined) return ANONYMOUS
        let expires = opened.expires
        const life = ttl()
        if (expires - Date.now() < life / 2 && scope.applied === false) {
            expires = Date.now() + life
            writeSeal(opened.claims, expires)
        }
        return documentOf(opened.claims, expires)
    })()
    return scope.principal
}

// 26.5, 26.6 — READ OFF ITS OWN COOKIE OR MINTED, and untouched by a sign-in.
export function callerFor(): string {
    const scope = within('principal.caller')
    return callerOf() ?? mintCaller(scope)
}

// 26.8, 26.21 — AUTHENTICATES THIS CALLER, before the headers are out, leaving `caller` where it was.
async function set(claims: unknown): Promise<void> {
    const scope = within('principal.set')
    if (scope.applied)
        throw new Error(
            'abide: principal.set was called after the response headers went out, so the cookie cannot be written. RULEBOOK 26.21.',
        )
    const expires = Date.now() + ttl()
    writeSeal(claims, expires)
    const resolved = documentOf(claims, expires)
    scope.principal = resolved
    principalMembers().document.set(await resolved)
    PRINCIPAL_LOG.debug('set')
}

// 26.7, 26.9 — SIGNS OUT NOW AND NEXT TIME, and rotates `caller` so the next visitor at this browser is
// not the last one.
function clear(): void {
    const scope = within('principal.clear')
    cookies().delete(PRINCIPAL_COOKIE)
    const minted = mintCaller(scope)
    scope.principal = Promise.resolve(ANONYMOUS)
    principalMembers().document.set(ANONYMOUS)
    principalMembers().caller.set(minted)
    PRINCIPAL_LOG.debug('clear')
}

// 21.4 — the answer is about this caller alone, and is never cached.
PRINCIPAL.document = resolvePrincipal
PRINCIPAL.caller = callerFor
PRINCIPAL.set = set
PRINCIPAL.clear = clear
