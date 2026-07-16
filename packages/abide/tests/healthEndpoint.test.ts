import { describe, expect, test } from 'bun:test'
import { probeAbideServer } from '../src/lib/bundle/probeAbideServer.ts'
import { createLivenessWatch } from '../src/lib/shared/createLivenessWatch.ts'
import { HEALTH_PATH } from '../src/lib/shared/HEALTH_PATH.ts'
import { health } from '../src/lib/shared/health.ts'
import { IDENTITY_PATH } from '../src/lib/shared/IDENTITY_PATH.ts'
import { bootTestServer } from './support/bootTestServer.ts'

describe('health endpoint', () => {
    test('the app health hook merges into the payload; framework keys win', async () => {
        const { origin, stop } = await bootTestServer({
            app: {
                health: (request) => ({
                    authenticated: request.headers.get('cookie') === 'session=ok',
                    // A colliding key must not shadow the framework's contract.
                    abide: false,
                    name: 'spoofed',
                }),
            },
        })
        try {
            const anonymous = await (await fetch(`${origin}${HEALTH_PATH}`)).json()
            // `abide` carries the framework version — truthy for probes, informative for skew.
            expect(anonymous.abide).toMatch(/^\d+\.\d+\.\d+/)
            expect(anonymous.authenticated).toBe(false)
            expect(anonymous.name).not.toBe('spoofed')
            const authed = await (
                await fetch(`${origin}${HEALTH_PATH}`, { headers: { cookie: 'session=ok' } })
            ).json()
            expect(authed.authenticated).toBe(true)
        } finally {
            stop()
        }
    })

    test('a throwing hook still serves the base payload — an app bug is not unreachability', async () => {
        const { origin, stop } = await bootTestServer({
            app: {
                health: () => {
                    throw new Error('session store down')
                },
            },
        })
        try {
            const body = await (await fetch(`${origin}${HEALTH_PATH}`)).json()
            expect(body.abide).toMatch(/^\d+\.\d+\.\d+/)
        } finally {
            stop()
        }
    })

    test('identity alias serves the same fields with the legacy abide:true shape', async () => {
        const { origin, stop } = await bootTestServer({
            app: { health: () => ({ authenticated: false }) },
        })
        try {
            const body = await (await fetch(`${origin}${IDENTITY_PATH}`)).json()
            /* Shipped probers check `abide === true` strictly — the alias keeps that shape. */
            expect(body.abide).toBe(true)
            expect(body.authenticated).toBe(false)
        } finally {
            stop()
        }
    })

    test('probeAbideServer falls back to the identity alias for older servers', async () => {
        /* An "older" abide server: answers identity, 404s health. */
        const legacy = Bun.serve({
            port: 0,
            fetch(req) {
                const { pathname } = new URL(req.url)
                if (pathname === IDENTITY_PATH) {
                    return Response.json({ abide: true, name: 'legacy', version: '0.1.0' })
                }
                return new Response('not found', { status: 404 })
            },
        })
        try {
            const identity = await probeAbideServer(`http://localhost:${legacy.port}`)
            expect(identity).toEqual({ name: 'legacy', version: '0.1.0' })
        } finally {
            legacy.stop(true)
        }
    })

    test('health() on the server reports reachable without polling', () => {
        expect(health()).toEqual({ reachable: true })
    })

    test('identity keys ride the payload health() captures — nothing is stripped', async () => {
        const { origin, stop } = await bootTestServer({
            app: { health: () => ({ authenticated: true }) },
        })
        try {
            const body = await (await fetch(`${origin}${HEALTH_PATH}`)).json()
            /* The client read returns this payload whole (plus reachable), so all keys must be present. */
            expect(Object.keys(body).sort()).toEqual(['abide', 'authenticated', 'name', 'version'])
        } finally {
            stop()
        }
    })

    test('a page that reads health() during SSR ships the seed in __SSR__', async () => {
        const { origin, stop } = await bootTestServer({
            pages: {
                '/health-page': () => import('./support/fixtures/pages/health.abide'),
                '/plain': () => import('./support/fixtures/pages/home.abide'),
            },
            app: { health: () => ({ authenticated: true }) },
        })
        try {
            const html = await (await fetch(`${origin}/health-page`)).text()
            const seed = ssrState(html)?.health as Record<string, unknown>
            /* The seed is the wire payload verbatim — hook fields + identity. */
            expect(seed.authenticated).toBe(true)
            expect(seed.abide).toMatch(/^\d+\.\d+\.\d+/)
            /* A render that never read health() ships no seed. */
            const plain = await (await fetch(`${origin}/plain`)).text()
            expect(ssrState(plain)?.health).toBeUndefined()
        } finally {
            stop()
        }
    })
})

/* Pulls the parsed `window.__SSR__` state object out of a rendered document — now an inert
   JSON `<script id="abide-ssr">` (ADR-0051) rather than a `window.__SSR__ = {…};` statement. */
function ssrState(html: string): Record<string, unknown> | undefined {
    const match = html.match(/<script type="application\/json" id="abide-ssr">(.+?)<\/script>/)
    return match ? JSON.parse(match[1]) : undefined
}

describe('createLivenessWatch continuous mode', () => {
    test('onChange fires on transitions only and polling continues past a loss', async () => {
        const transitions: boolean[] = []
        const script = [true, false, false, false, true]
        let calls = 0
        const watcher = createLivenessWatch({
            probe: async () => script[calls++] ?? true,
            onChange: (alive) => transitions.push(alive),
            intervalMs: 1,
            failureLimit: 2,
        })
        watcher.watch('http://target.local')
        await Bun.sleep(50)
        watcher.stop()
        /*
        First success after watch() always reports (the consumer resync), then
        down once (second consecutive miss), up once (next success) — no
        per-poll noise.
        */
        expect(transitions).toEqual([true, false, true])
        expect(calls).toBeGreaterThanOrEqual(5)
    })

    test('probeNow probes immediately instead of waiting out the interval', async () => {
        let calls = 0
        const watcher = createLivenessWatch({
            probe: async () => {
                calls += 1
                return true
            },
            onChange: () => {},
            intervalMs: 60_000,
        })
        watcher.watch('http://target.local')
        expect(calls).toBe(0)
        watcher.probeNow()
        await Bun.sleep(10)
        expect(calls).toBe(1)
        watcher.stop()
    })
})
