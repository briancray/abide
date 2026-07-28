// `identity()` is ISOMORPHIC (auth.md AU3): same import, same call, both sides. The claims that matter
// are the ones a one-sided implementation would still pass, so each is checked where it actually lives:
//
//   - a handler and a TEMPLATE read the same principal on the server;
//   - the browser answers WITHOUT a request scope, from what the server seeded;
//   - it is REACTIVE there — an adopted change wakes readers, an identical re-adopt does not;
//   - `set`/`clear` throw in a browser instead of pretending, because sealing needs the server;
//   - `/__abide/identity` reports the caller's own principal, which is what makes an opaque sealed
//     credential debuggable without making it forgeable.

import { afterEach, describe, expect, test } from 'bun:test'
import { createTestApp } from '../test/createTestApp.ts'
import { identity } from './identity.ts'
import { adoptIdentity } from './internal/adoptIdentity.ts'
import { IDENTITY_ROUTE } from './internal/IDENTITY_ROUTE.ts'
import { clearClientIdentity } from './internal/identityHolder.ts'
import { watch } from './watch.ts'

// Effects re-run on a scheduled flush, not synchronously — a wake-up assertion has to wait for it.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

afterEach(() => {
    clearClientIdentity()
})

describe('identity() — server', () => {
    test('a handler and a template read the request principal, and the route reports it', async () => {
        const app = await createTestApp({
            pages: {
                '/': `<script>import { identity } from 'abide/shared/identity'</script><p>who:{identity().authenticated}</p>`,
            },
        })
        try {
            const html = await (await app.fetch('/')).text()
            // No credential → the anonymous floor, rendered server-side.
            expect(html).toContain('who:false')

            const reported = await app.fetch(IDENTITY_ROUTE)
            expect(reported.status).toBe(200)
            const principal = (await reported.json()) as { id: string; authenticated: boolean }
            expect(principal.authenticated).toBe(false)
            expect(typeof principal.id).toBe('string')
        } finally {
            await app.stop()
        }
    })

    test('the route answers as whoever the bearer ladder resolved', async () => {
        const previous = Bun.env.ABIDE_APP_TOKEN
        Bun.env.ABIDE_APP_TOKEN = 'identity-test-token'
        const app = await createTestApp({ pages: { '/': '<h1>x</h1>' } })
        try {
            const response = await app.fetch(IDENTITY_ROUTE, {
                headers: { authorization: 'Bearer identity-test-token' },
            })
            expect(await response.json()).toMatchObject({ appOwner: true, authenticated: true })
        } finally {
            await app.stop()
            if (previous === undefined) delete Bun.env.ABIDE_APP_TOKEN
            else Bun.env.ABIDE_APP_TOKEN = previous
        }
    })

    test('the rendered page seeds the principal, so the browser can answer without asking', async () => {
        const app = await createTestApp({ pages: { '/': '<h1>x</h1>' } })
        try {
            const html = await (await app.fetch('/')).text()
            const seed = JSON.parse(
                /<script type="application\/json" id="__abide-seed">(.*?)<\/script>/s.exec(
                    html,
                )?.[1] ?? '{}',
            ) as { identity?: { authenticated: boolean } }
            expect(seed.identity).toMatchObject({ authenticated: false })
        } finally {
            await app.stop()
        }
    })
})

describe('identity() — browser', () => {
    test('answers from what the server adopted, with no request scope in sight', () => {
        adoptIdentity({ id: 'u1', authenticated: true, email: 'a@b.c' })
        expect(identity()).toMatchObject({ id: 'u1', authenticated: true, email: 'a@b.c' })
    })

    test('is REACTIVE — a real change wakes readers, an identical re-adopt does not', async () => {
        adoptIdentity({ id: 'u1', authenticated: true })
        let runs = 0
        const stop = watch(() => {
            identity()
            runs++
        })
        expect(runs).toBe(1)

        // Same principal, fresh object — every navigation decodes one of these out of its seed. Waking
        // every `identity()` binding per nav to say nothing changed is the bug this guards.
        adoptIdentity({ id: 'u1', authenticated: true })
        await tick()
        expect(runs).toBe(1)

        adoptIdentity({ id: 'u2', authenticated: true })
        await tick()
        expect(runs).toBe(2)
        // Disposed before the holder is cleared: a live reader would otherwise re-run against "nobody
        // adopted anything", which off the client side is the fail-closed throw.
        stop()
    })

    test('a malformed principal off the wire is dropped, leaving the last good one standing', () => {
        adoptIdentity({ id: 'u1', authenticated: true })
        adoptIdentity({ id: 42, authenticated: true } as unknown as {
            id: string
            authenticated: boolean
        })
        adoptIdentity(null)
        expect(identity().id).toBe('u1')
    })

    test('set/clear throw on the client and name the fix, rather than silently doing nothing', () => {
        // A hydrated tab: the server's principal has been adopted, and there is no request scope.
        adoptIdentity({ id: 'u1', authenticated: true })
        expect(() => identity.set({ id: 'forged' })).toThrow(/cannot seal an identity/)
        expect(() => identity.clear()).toThrow(/cannot seal an identity/)
    })
})
