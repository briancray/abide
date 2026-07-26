import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import {
    clearIdentityCookieHeader,
    identityCookieHeader,
    identityCookieIsDue,
    isProd,
    requireSecretForAuthedSet,
    resolveIdentity,
    resolveIdentityDetailed,
    unrecognizedNodeEnv,
} from './auth.ts'
import type { Principal } from './requestScope.ts'
import { seal } from './seal.ts'

const originalSecret = Bun.env.ABIDE_IDENTITY_SECRET
const originalAppToken = Bun.env.ABIDE_APP_TOKEN
const originalNodeEnv = Bun.env.NODE_ENV

beforeAll(() => {
    Bun.env.ABIDE_IDENTITY_SECRET = 'auth-test-secret-value'
})

afterEach(() => {
    delete Bun.env.ABIDE_APP_TOKEN
})

afterAll(() => {
    if (originalSecret === undefined) delete Bun.env.ABIDE_IDENTITY_SECRET
    else Bun.env.ABIDE_IDENTITY_SECRET = originalSecret
    if (originalAppToken === undefined) delete Bun.env.ABIDE_APP_TOKEN
    else Bun.env.ABIDE_APP_TOKEN = originalAppToken
    if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV
    else Bun.env.NODE_ENV = originalNodeEnv
})

function requestWith(headers: Record<string, string>): Request {
    return new Request('http://localhost/rpc/test', { headers })
}

describe('resolveIdentity — bearer ladder', () => {
    test('app-token bearer resolves to the app-owner principal', async () => {
        Bun.env.ABIDE_APP_TOKEN = 'super-secret-app-token'
        const identity = await resolveIdentity(
            requestWith({ authorization: 'Bearer super-secret-app-token' }),
        )
        expect(identity.id).toBe('app-owner')
        expect(identity.authenticated).toBe(true)
        expect(identity.appOwner).toBe(true)
    })

    test('a non-matching bearer that is not a sealed identity falls through to anonymous', async () => {
        Bun.env.ABIDE_APP_TOKEN = 'super-secret-app-token'
        const identity = await resolveIdentity(requestWith({ authorization: 'Bearer wrong-token' }))
        expect(identity.id).not.toBe('app-owner')
        expect(identity.authenticated).toBe(false)
    })

    test("a sealed bearer resolves to that user's principal", async () => {
        const principal: Principal = { id: 'user-42', authenticated: true, name: 'Grace' }
        const token = await seal(principal)
        const identity = await resolveIdentity(requestWith({ authorization: `Bearer ${token}` }))
        expect(identity).toEqual(principal)
    })

    test('app-token takes precedence over unsealing when the bearer matches', async () => {
        Bun.env.ABIDE_APP_TOKEN = 'super-secret-app-token'
        const identity = await resolveIdentity(
            requestWith({ authorization: 'Bearer super-secret-app-token' }),
        )
        expect(identity.appOwner).toBe(true)
    })
})

describe('resolveIdentity — cookie and anonymous rungs', () => {
    test('the abide-identity cookie resolves to that principal', async () => {
        const principal: Principal = { id: 'cookie-user', authenticated: true, tier: 'pro' }
        const token = await seal(principal)
        const identity = await resolveIdentity(
            requestWith({ cookie: `abide-identity=${token}; other=x` }),
        )
        expect(identity).toEqual(principal)
    })

    test('a tampered cookie falls through to a fresh anonymous principal', async () => {
        const identity = await resolveIdentity(
            requestWith({ cookie: 'abide-identity=garbage-value' }),
        )
        expect(identity.authenticated).toBe(false)
        expect(typeof identity.id).toBe('string')
    })

    test('no bearer and no cookie yields a fresh anonymous principal', async () => {
        const a = await resolveIdentity(requestWith({}))
        const b = await resolveIdentity(requestWith({}))
        expect(a.authenticated).toBe(false)
        expect(b.authenticated).toBe(false)
        expect(a.id).not.toBe(b.id) // fresh, untracked each time
    })
})

describe('identity cookie headers', () => {
    test('identityCookieHeader carries the sealed value plus security attributes', async () => {
        const header = await identityCookieHeader({ id: 'cookie-writer', authenticated: true })
        expect(header).toStartWith('abide-identity=')
        expect(header).toContain('HttpOnly')
        expect(header).toContain('SameSite=Lax')
        expect(header).toContain('Path=/')
        expect(header).toMatch(/Max-Age=\d+/)
    })

    test('clearIdentityCookieHeader expires the cookie', () => {
        const header = clearIdentityCookieHeader()
        expect(header).toContain('abide-identity=')
        expect(header).toContain('Max-Age=0')
        expect(header).toContain('HttpOnly')
    })

    test('Secure is added only in production', async () => {
        Bun.env.NODE_ENV = 'development'
        expect(await identityCookieHeader({ id: 'x', authenticated: false })).not.toContain(
            'Secure',
        )
        Bun.env.NODE_ENV = 'production'
        expect(await identityCookieHeader({ id: 'x', authenticated: false })).toContain('Secure')
        if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV
        else Bun.env.NODE_ENV = originalNodeEnv
    })
})

describe('isProd / requireSecretForAuthedSet', () => {
    test('isProd tracks NODE_ENV', () => {
        Bun.env.NODE_ENV = 'production'
        expect(isProd()).toBe(true)
        Bun.env.NODE_ENV = 'development'
        expect(isProd()).toBe(false)
        if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV
        else Bun.env.NODE_ENV = originalNodeEnv
    })

    // H2: isProd is the single gate for the Secure cookie, HSTS, and the identity-secret fail-fast, so a
    // case/whitespace misconfig must fail SAFE (enable the prod posture), and unset must be non-prod.
    test.each([
        ['production', true],
        ['Production', true],
        ['PRODUCTION', true],
        ['  production  ', true],
        ['development', false],
        ['test', false],
        ['prod', false],
        ['staging', false],
        ['', false],
    ])('isProd(%p) === %p (case/whitespace-insensitive, fail-safe)', (value, expected) => {
        Bun.env.NODE_ENV = value
        expect(isProd()).toBe(expected)
        if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV
        else Bun.env.NODE_ENV = originalNodeEnv
    })

    test('isProd is false when NODE_ENV is unset', () => {
        delete Bun.env.NODE_ENV
        expect(isProd()).toBe(false)
        if (originalNodeEnv !== undefined) Bun.env.NODE_ENV = originalNodeEnv
    })

    // unrecognizedNodeEnv drives the boot warning: only a SET, non-standard value is flagged.
    test.each([
        ['production', undefined],
        ['Production', undefined],
        ['development', undefined],
        ['test', undefined],
        ['prod', 'prod'],
        ['staging', 'staging'],
    ])('unrecognizedNodeEnv(%p) === %p', (value, expected) => {
        Bun.env.NODE_ENV = value
        expect(unrecognizedNodeEnv()).toBe(expected)
        if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV
        else Bun.env.NODE_ENV = originalNodeEnv
    })

    test('unrecognizedNodeEnv is undefined when NODE_ENV is unset (conventional dev, not flagged)', () => {
        delete Bun.env.NODE_ENV
        expect(unrecognizedNodeEnv()).toBeUndefined()
        if (originalNodeEnv !== undefined) Bun.env.NODE_ENV = originalNodeEnv
    })

    test('does not throw for an anonymous set', () => {
        Bun.env.NODE_ENV = 'production'
        const secret = Bun.env.ABIDE_IDENTITY_SECRET
        delete Bun.env.ABIDE_IDENTITY_SECRET
        expect(() => requireSecretForAuthedSet(false)).not.toThrow()
        if (secret === undefined) delete Bun.env.ABIDE_IDENTITY_SECRET
        else Bun.env.ABIDE_IDENTITY_SECRET = secret
        if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV
        else Bun.env.NODE_ENV = originalNodeEnv
    })

    test('throws for an authenticated set in prod without a secret', () => {
        Bun.env.NODE_ENV = 'production'
        const secret = Bun.env.ABIDE_IDENTITY_SECRET
        delete Bun.env.ABIDE_IDENTITY_SECRET
        expect(() => requireSecretForAuthedSet(true)).toThrow(/ABIDE_IDENTITY_SECRET/)
        if (secret === undefined) delete Bun.env.ABIDE_IDENTITY_SECRET
        else Bun.env.ABIDE_IDENTITY_SECRET = secret
        if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV
        else Bun.env.NODE_ENV = originalNodeEnv
    })

    test('allows an authenticated set in prod when the secret is present', () => {
        Bun.env.NODE_ENV = 'production'
        Bun.env.ABIDE_IDENTITY_SECRET = 'auth-test-secret-value'
        expect(() => requireSecretForAuthedSet(true)).not.toThrow()
        if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV
        else Bun.env.NODE_ENV = originalNodeEnv
    })

    test('does not throw for an authenticated set outside prod', () => {
        Bun.env.NODE_ENV = 'development'
        const secret = Bun.env.ABIDE_IDENTITY_SECRET
        delete Bun.env.ABIDE_IDENTITY_SECRET
        expect(() => requireSecretForAuthedSet(true)).not.toThrow()
        if (secret === undefined) delete Bun.env.ABIDE_IDENTITY_SECRET
        else Bun.env.ABIDE_IDENTITY_SECRET = secret
        if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV
        else Bun.env.NODE_ENV = originalNodeEnv
    })
})

describe('rolling cookie — only re-seal when it is actually due', () => {
    const DEFAULT_TTL = 30 * 24 * 60 * 60 * 1000

    test('no readable cookie means one must be written', () => {
        expect(identityCookieIsDue(undefined)).toBe(true)
    })

    test('an already-expired cookie is due', () => {
        expect(identityCookieIsDue(Date.now() - 1000)).toBe(true)
    })

    test('a freshly-issued cookie is NOT due — this is the per-response seal we are skipping', () => {
        expect(identityCookieIsDue(Date.now() + DEFAULT_TTL)).toBe(false)
    })

    test('a cookie still inside the roll window is not due', () => {
        // 2 days elapsed of 30 — under the 10% (3-day) roll threshold
        expect(identityCookieIsDue(Date.now() + DEFAULT_TTL - 2 * 24 * 60 * 60 * 1000)).toBe(false)
    })

    test('a cookie past the roll window IS due, so an active session still rolls forward', () => {
        // 5 days elapsed of 30 — past the threshold
        expect(identityCookieIsDue(Date.now() + DEFAULT_TTL - 5 * 24 * 60 * 60 * 1000)).toBe(true)
    })

    test('resolveIdentityDetailed reports the cookie exp so the router can make that call', async () => {
        const before = Date.now()
        const token = await seal({ id: 'roller', authenticated: true })
        const resolved = await resolveIdentityDetailed(
            requestWith({ cookie: `abide-identity=${token}` }),
        )
        expect(resolved.principal.id).toBe('roller')
        expect(resolved.cookieExpiresAt).toBeGreaterThanOrEqual(before + DEFAULT_TTL - 5000)
        expect(identityCookieIsDue(resolved.cookieExpiresAt)).toBe(false)
    })

    test('a bearer rung reports no cookie expiry — a bearer never persists one', async () => {
        const token = await seal({ id: 'machine', authenticated: true })
        const resolved = await resolveIdentityDetailed(
            requestWith({ authorization: `Bearer ${token}` }),
        )
        expect(resolved.principal.id).toBe('machine')
        expect(resolved.cookieExpiresAt).toBeUndefined()
    })

    test('an anonymous fallback reports no expiry, so the first response writes a cookie', async () => {
        const resolved = await resolveIdentityDetailed(requestWith({}))
        expect(resolved.principal.authenticated).toBe(false)
        expect(resolved.cookieExpiresAt).toBeUndefined()
        expect(identityCookieIsDue(resolved.cookieExpiresAt)).toBe(true)
    })
})
