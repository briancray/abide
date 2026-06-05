import { describe, expect, test } from 'bun:test'
import { cookies } from '../src/lib/server/cookies.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'

const options = { logRequests: false }

describe('cookies', () => {
    test('reads the inbound Cookie header', async () => {
        const req = new Request('https://test.local/', {
            headers: { cookie: 'session=abc; theme=dark' },
        })
        await runWithRequestScope(req, options, async () => {
            expect(cookies().get('session')).toBe('abc')
            expect(cookies().get('theme')).toBe('dark')
            return new Response('ok')
        })
    })

    test('flushes set/delete to Set-Cookie on the response', async () => {
        const req = new Request('https://test.local/', {
            headers: { cookie: 'stale=1' },
        })
        const response = await runWithRequestScope(req, options, async () => {
            cookies().set('session', 'tok', { httpOnly: true, sameSite: 'lax' })
            cookies().delete('stale')
            return new Response('ok')
        })
        const setCookies = response.headers.getSetCookie()
        expect(setCookies.some((header) => header.startsWith('session=tok'))).toBe(true)
        expect(setCookies.some((header) => header.includes('HttpOnly'))).toBe(true)
        // delete emits an expiry header so the browser drops the stale cookie.
        expect(
            setCookies.some((header) => header.startsWith('stale=') && header.includes('Expires')),
        ).toBe(true)
    })

    test('emits nothing when the jar is never touched', async () => {
        const response = await runWithRequestScope(
            new Request('https://test.local/', { headers: { cookie: 'a=1' } }),
            options,
            async () => new Response('ok'),
        )
        expect(response.headers.getSetCookie()).toEqual([])
    })

    test('preserves a Set-Cookie already on the response', async () => {
        const response = await runWithRequestScope(
            new Request('https://test.local/'),
            options,
            async () => {
                cookies().set('a', '1')
                return new Response('ok', { headers: { 'set-cookie': 'b=2' } })
            },
        )
        const setCookies = response.headers.getSetCookie()
        expect(setCookies.some((header) => header.startsWith('a=1'))).toBe(true)
        expect(setCookies.some((header) => header.startsWith('b=2'))).toBe(true)
    })

    test('throws outside a request scope', () => {
        expect(() => cookies()).toThrow('outside a request scope')
    })
})
