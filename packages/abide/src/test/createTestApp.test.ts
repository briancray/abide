import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { error } from '../server/error.ts'
import { GET } from '../server/GET.ts'
import { identity } from '../server/identity.ts'
import type { Middleware } from '../server/internal/middleware.ts'
import { POST } from '../server/POST.ts'
import { createTestApp, identityCookie, type TestApp } from './createTestApp.ts'

let running: TestApp | undefined

function start(config?: Parameters<typeof createTestApp>[0]): TestApp {
    const app = createTestApp(config)
    running = app
    return app
}

afterEach(async () => {
    if (running !== undefined) {
        await running.stop()
        running = undefined
    }
})

const greet = GET(async (args: { name: string }) => ({ greeting: `hello ${args.name}` }))

// A trivial in-memory mutation: bumps a module counter and returns the new total.
let counter = 0
const bump = POST(async (args: { by?: number }) => {
    counter += args.by ?? 1
    return { total: counter }
})

describe('createTestApp routing', () => {
    test('origin is a localhost URL on an ephemeral port', () => {
        const app = start({ routes: { greet } })
        expect(app.origin).toMatch(/^http:\/\/localhost:\d+$/)
    })

    test('GET rpc via raw fetch returns 200 + json', async () => {
        const app = start({ routes: { greet } })
        const response = await app.fetch(
            `/rpc/greet?args=${encodeURIComponent(JSON.stringify({ name: 'x' }))}`,
        )
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('application/json')
        expect(await response.json()).toEqual({ greeting: 'hello x' })
    })

    test('GET rpc via the rpc proxy returns the value', async () => {
        const app = start({ routes: { greet } })
        const greetRpc = app.rpc.greet
        if (greetRpc === undefined) throw new Error('greet rpc not registered')
        expect(await greetRpc({ name: 'x' })).toEqual({ greeting: 'hello x' })
    })

    test('POST mutation via the rpc proxy mutates and returns', async () => {
        counter = 0
        const app = start({ routes: { bump } })
        const bumpRpc = app.rpc.bump
        if (bumpRpc === undefined) throw new Error('bump rpc not registered')
        expect(await bumpRpc({ by: 2 })).toEqual({ total: 2 })
        expect(await bumpRpc({ by: 3 })).toEqual({ total: 5 })
    })

    test('POST mutation via raw fetch reads args from the body', async () => {
        counter = 0
        const app = start({ routes: { bump } })
        const response = await app.fetch('/rpc/bump', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ by: 4 }),
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ total: 4 })
    })

    test('unknown rpc 404s', async () => {
        const app = start({ routes: { greet } })
        const response = await app.fetch('/rpc/nope?args=%7B%7D')
        expect(response.status).toBe(404)
    })

    test('non-rpc path 404s', async () => {
        const app = start({ routes: { greet } })
        const response = await app.fetch('/whatever')
        expect(response.status).toBe(404)
    })
})

describe('middleware', () => {
    test('a short-circuiting middleware returns 403 before the handler', async () => {
        let handlerRan = false
        const guard: Middleware = () => error(403, 'denied')
        const guarded = GET(async () => {
            handlerRan = true
            return { ok: true }
        })
        const app = start({ routes: { guarded }, middleware: [guard] })
        const response = await app.fetch('/rpc/guarded?args=%7B%7D')
        expect(response.status).toBe(403)
        expect(handlerRan).toBe(false)
    })

    test('per-rpc middleware runs inside the global chain', async () => {
        const order: string[] = []
        const globalMw: Middleware = async (next) => {
            order.push('global-in')
            const r = await next()
            order.push('global-out')
            return r
        }
        const localMw: Middleware = async (next) => {
            order.push('local-in')
            const r = await next()
            order.push('local-out')
            return r
        }
        const handler = GET(
            async () => {
                order.push('handler')
                return { ok: true }
            },
            { middleware: [localMw] },
        )
        const app = start({ routes: { handler }, middleware: [globalMw] })
        await app.fetch('/rpc/handler?args=%7B%7D')
        expect(order).toEqual(['global-in', 'local-in', 'handler', 'local-out', 'global-out'])
    })
})

describe('identity', () => {
    test('as(identity) impersonates the caller for the handler', async () => {
        const whoami = GET(async () => ({
            id: identity().id,
            authenticated: identity().authenticated,
        }))
        const app = start({ routes: { whoami } })

        const whoamiRpc = app.rpc.whoami
        if (whoamiRpc === undefined) throw new Error('whoami rpc not registered')
        const anon = (await whoamiRpc()) as { authenticated: boolean }
        expect(anon.authenticated).toBe(false)

        const asUser = app.as({ id: 'user-1', authenticated: true })
        const asUserWhoami = asUser.rpc.whoami
        if (asUserWhoami === undefined) throw new Error('whoami rpc not registered')
        const seen = (await asUserWhoami()) as { id: string; authenticated: boolean }
        expect(seen.id).toBe('user-1')
        expect(seen.authenticated).toBe(true)
    })
})

describe('auth (M7) — cookie login, bearer, anonymous tracking, CSRF', () => {
    const originalAppToken = Bun.env.ABIDE_APP_TOKEN
    afterAll(() => {
        if (originalAppToken === undefined) delete Bun.env.ABIDE_APP_TOKEN
        else Bun.env.ABIDE_APP_TOKEN = originalAppToken
    })

    const login = POST(async () => {
        identity.set({ id: 'u1', authenticated: true })
        return { ok: true }
    })
    const whoami = GET(async () => ({ id: identity().id, authenticated: identity().authenticated }))

    test('(a) login sets an abide-identity cookie a follow-up request authenticates with', async () => {
        const app = start({ routes: { login, whoami } })

        const loginResponse = await app.fetch('/rpc/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
        })
        expect(loginResponse.status).toBe(200)
        const cookie = identityCookie(loginResponse)
        expect(cookie).toBeDefined()
        expect(cookie).toStartWith('abide-identity=')
        if (cookie === undefined) throw new Error('expected an identity cookie')

        const follow = await app.fetch(`/rpc/whoami?args=%7B%7D`, { headers: { cookie } })
        const seen = (await follow.json()) as { id: string; authenticated: boolean }
        expect(seen.authenticated).toBe(true)
        expect(seen.id).toBe('u1')
    })

    test('(b) as(identity).rpc.whoami() authenticates via the bearer path', async () => {
        const app = start({ routes: { whoami } })
        const bearerWhoami = app.as({ id: 'u1', authenticated: true }).rpc.whoami
        if (bearerWhoami === undefined) throw new Error('whoami rpc not registered')
        const seen = (await bearerWhoami()) as {
            id: string
            authenticated: boolean
        }
        expect(seen.authenticated).toBe(true)
        expect(seen.id).toBe('u1')
    })

    test('(c) an anonymous request is authenticated:false with a stable-per-cookie id', async () => {
        const app = start({ routes: { whoami } })

        const first = await app.fetch('/rpc/whoami?args=%7B%7D')
        const firstBody = (await first.json()) as { id: string; authenticated: boolean }
        expect(firstBody.authenticated).toBe(false)
        const cookie = identityCookie(first)
        expect(cookie).toBeDefined()
        if (cookie === undefined) throw new Error('expected an identity cookie')

        const second = await app.fetch('/rpc/whoami?args=%7B%7D', { headers: { cookie } })
        const secondBody = (await second.json()) as { id: string }
        expect(secondBody.id).toBe(firstBody.id) // stable across requests carrying the cookie
    })

    test('(d) a mutation with a simple Content-Type is rejected 403 (CSRF); application/json passes', async () => {
        const app = start({ routes: { login } })

        const blocked = await app.fetch('/rpc/login', {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body: '{}',
        })
        expect(blocked.status).toBe(403)

        const allowed = await app.fetch('/rpc/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
        })
        expect(allowed.status).toBe(200)
    })

    test('(e) an ABIDE_APP_TOKEN bearer resolves to the app-owner principal', async () => {
        Bun.env.ABIDE_APP_TOKEN = 'test-app-token-value'
        const owner = GET(async () => ({ ...identity() }))
        const app = start({ routes: { owner } })
        const response = await app.fetch('/rpc/owner?args=%7B%7D', {
            headers: { authorization: 'Bearer test-app-token-value' },
        })
        const principal = (await response.json()) as {
            id: string
            authenticated: boolean
            appOwner?: boolean
        }
        expect(principal.id).toBe('app-owner')
        expect(principal.authenticated).toBe(true)
        expect(principal.appOwner).toBe(true)
        delete Bun.env.ABIDE_APP_TOKEN
    })
})

describe('health + lifecycle', () => {
    test('/__abide/health returns { reachable: true }', async () => {
        const app = start()
        const response = await app.health()
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ reachable: true })
    })

    test('stop() closes the server so further fetches fail', async () => {
        const app = createTestApp()
        const origin = app.origin
        await app.health()
        await app.stop()
        running = undefined
        await expect(fetch(`${origin}/__abide/health`)).rejects.toThrow()
    })
})
