// SECTION 26 — THE PRINCIPAL, RESOLVED ON A SERVER. The claims ride in a cookie the server sealed —
// a JWT signed HS256, the claims its payload beside `exp` and `iat`, signed rather than encrypted
// (26.11), so any service holding the secret can verify it — and so there is no
// store to look them up in and nothing to revoke (26.16). Resolved at most once per request (26.14),
// by `onPrincipal` where the app registered one, and the baseline is laid over what it answered (26.4).

import { PRINCIPAL_ADDRESS } from '#shared/ADDRESSES.ts'
import { cookies } from '#shared/cookies.ts'
import { isFailed } from '#shared/Failed.ts'
import { isRecord } from '#shared/isRecord.ts'
import { namedLogger } from '#shared/log.ts'
import { PRINCIPAL_HEADER } from '#shared/PRINCIPAL_HEADER.ts'
import {
    type PRINCIPAL,
    type Principal,
    principalMembers,
} from '#shared/principal.ts'
import { refuse } from '#shared/refuse.ts'
import { declare } from '#shared/rpc.ts'
import { mountedOwn } from './answerRpc.ts'
import { callerOrMint, mintCaller } from './callerOf.ts'
import { config, positiveSetting } from './config.ts'
import { HOOKS, inOrder } from './hooks.ts'
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

/**
 * The secrets in `ABIDE_PRINCIPAL_SECRET`, signing one first.
 *
 * 36.5 — A LIST: the first secret signs, and every one verifies, so a secret can be rotated in.
 */
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

/** The JWT header every seal carries, and the only one a seal is read under: HS256, never `none`. */
const JWT_HEADER = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
).toString('base64url')

/** The claims as a JWT (RFC 7519): their own members, with `exp` and `iat` in seconds. */
function seal(
    claims: Record<string, unknown>,
    expires: number,
    secret: string,
): string {
    const payload = Buffer.from(
        JSON.stringify({
            ...claims,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(expires / 1000),
        }),
    ).toString('base64url')
    const signed = `${JWT_HEADER}.${payload}`
    return `${signed}.${signature(secret, signed)}`
}

/**
 * The claims and expiry a sealed cookie holds, or `undefined`.
 *
 * 26.13 — A BAD SIGNATURE, A LAPSED SEAL AND A MALFORMED COOKIE ARE ONE ANSWER: nothing.
 */
function unseal(
    sealed: string | null,
): { claims: Record<string, unknown>; expires: number } | undefined {
    if (sealed === null) return undefined
    const [header, payload, signed, ...rest] = sealed.split('.')
    // ONE HEADER IS READ, abide's own: a token naming another `alg` — `none` above all — is no seal.
    if (header !== JWT_HEADER || payload === undefined || rest.length > 0)
        return undefined
    const given = Buffer.from(signed ?? '', 'base64url')
    let verified = false
    for (const secret of secrets()) {
        const expected = Buffer.from(
            signature(secret, `${header}.${payload}`),
            'base64url',
        )
        if (
            expected.length === given.length &&
            crypto.timingSafeEqual(expected, given)
        )
            verified = true
    }
    if (!verified) return undefined
    try {
        const opened: unknown = JSON.parse(
            Buffer.from(payload, 'base64url').toString(),
        )
        if (!isRecord(opened)) return undefined
        const { exp, iat: _, ...claims } = opened
        if (typeof exp !== 'number' || exp * 1000 <= Date.now())
            return undefined
        return { claims, expires: exp * 1000 }
    } catch {
        return undefined
    }
}

function writeSeal(claims: Record<string, unknown>, expires: number): void {
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
    const resolvers = inOrder(HOOKS.principal)
    if (resolvers.length === 0)
        return { ...(isRecord(claims) ? claims : {}), ...baseline }
    try {
        // 37.7 — EVERY RESOLVER, handed the claims, its answer merged over the ones before it.
        const resolved: Record<string, unknown> = {}
        for (const resolve of resolvers) {
            const answered = await resolve(claims)
            if (isRecord(answered)) Object.assign(resolved, answered)
        }
        return { ...resolved, ...baseline }
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

/**
 * This request's principal, resolved from its cookie at most once.
 *
 * 26.14 — ONCE PER REQUEST, and 26.15 — a seal half spent is sealed again for another full life.
 */
function resolvePrincipal(): Promise<Principal> {
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

/**
 * Signs this caller in with `claims`, sealing them into the cookie.
 *
 * 26.8, 26.21 — AUTHENTICATES THIS CALLER, before the headers are out, leaving `caller` where it
 * was. The answer says so in `PRINCIPAL_HEADER`, which is what has the browser's `principal` load
 * the document again: the cookie it rides in is `HttpOnly`, and a `set-cookie` is a header no
 * `fetch` may read.
 */
async function set(claims: Record<string, unknown>): Promise<void> {
    const scope = within('principal.set')
    // 26.11 — THE CLAIMS ARE A JWT's PAYLOAD, so they are its members: an object, and nothing else.
    if (!isRecord(claims))
        throw new Error(
            'abide: principal.set takes an object of claims, which become the JWT payload. RULEBOOK 26.11.',
        )
    if (scope.applied)
        throw new Error(
            'abide: principal.set was called after the response headers went out, so the cookie cannot be written. RULEBOOK 26.21.',
        )
    const expires = Date.now() + ttl()
    writeSeal(claims, expires)
    scope.response.headers.set(PRINCIPAL_HEADER, 'set')
    const resolved = documentOf(claims, expires)
    scope.principal = resolved
    principalMembers().document.set(await resolved)
    PRINCIPAL_LOG.debug('set')
}

/**
 * Signs this caller out and rotates `caller`.
 *
 * 26.7, 26.9 — SIGNS OUT NOW AND NEXT TIME, and rotates `caller` so the next visitor at this
 * browser is not the last one.
 */
function clear(): void {
    const scope = within('principal.clear')
    cookies().delete(PRINCIPAL_COOKIE)
    scope.response.headers.set(PRINCIPAL_HEADER, 'clear')
    const minted = mintCaller(scope)
    scope.principal = Promise.resolve(ANONYMOUS)
    principalMembers().document.set(ANONYMOUS)
    principalMembers().caller.set(minted)
    PRINCIPAL_LOG.debug('clear')
}

// 26.17 — THE DOCUMENT IS A `GET` LIKE ANY OTHER, so it reaches a browser as any handler's value does
// (41.5): a render's read of it is reported as the call it is, left in the seed buffer (41.13) and
// started from the head (41.20), and the browser's own read takes that answer rather than asking
// again. Built on the core's `declare` with no generated surface (20.1) — abide mounts it, not the
// app's tree.
const principalDocument = declare('GET')(resolvePrincipal, {
    clients: { ui: false, mcp: false, cli: false, openapi: false },
})

/** The handler `/__abide/principal` is answered by. */
export const PRINCIPAL_MOUNT = mountedOwn(
    PRINCIPAL_ADDRESS,
    'principal',
    principalDocument,
)

// 21.3 — the answer is about this caller alone, and is never cached. 1.4 — the call's `Reactive` is
// thenable, and a promise of it is the document.
export const SERVER_PRINCIPAL: typeof PRINCIPAL = {
    document: () => Promise.resolve(principalDocument()),
    caller: callerOrMint,
    set,
    clear,
}
