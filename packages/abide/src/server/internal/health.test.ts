// CO2.4 — the `/__abide/health` endpoint: framework stub + the app `onHealth` hook (merge, status,
// fail-closed, request scope).

import { describe, expect, test } from 'bun:test'
import { identity } from '../../shared/identity.ts'
import { createApp } from './router.ts'

async function fetchHealth(config: Parameters<typeof createApp>[0]): Promise<Response> {
    const app = createApp(config)
    try {
        return await fetch(`${app.origin}/__abide/health`)
    } finally {
        await app.stop()
    }
}

describe('/__abide/health', () => {
    test('without onHealth returns the framework stub, 200', async () => {
        const response = await fetchHealth({})
        expect(response.status).toBe(200)
        const body = (await response.json()) as Record<string, unknown>
        expect(body.reachable).toBe(true)
        expect(typeof body.version).toBe('string')
        expect(typeof body.startedAt).toBe('string')
        expect(typeof body.uptime).toBe('number')
    })

    test('onHealth fields merge over the stub, 200', async () => {
        const response = await fetchHealth({ onHealth: () => ({ db: 'ok', reachable: true }) })
        expect(response.status).toBe(200)
        const body = (await response.json()) as Record<string, unknown>
        expect(body.db).toBe('ok')
        expect(body.reachable).toBe(true)
        // Stub floor is still present.
        expect(typeof body.version).toBe('string')
    })

    test('onHealth reachable:false answers 503', async () => {
        const response = await fetchHealth({ onHealth: () => ({ reachable: false, db: 'down' }) })
        expect(response.status).toBe(503)
        const body = (await response.json()) as Record<string, unknown>
        expect(body.reachable).toBe(false)
        expect(body.db).toBe('down')
    })

    test('a throwing onHealth fails closed to 503 without leaking the error', async () => {
        const response = await fetchHealth({
            onHealth: () => {
                throw new Error('db unreachable secret detail')
            },
        })
        expect(response.status).toBe(503)
        const body = (await response.json()) as Record<string, unknown>
        expect(body.reachable).toBe(false)
        expect(JSON.stringify(body)).not.toContain('secret detail')
    })

    test('a non-object onHealth return is ignored (stub passes through)', async () => {
        const response = await fetchHealth({ onHealth: () => 'nope' })
        expect(response.status).toBe(200)
        const body = (await response.json()) as Record<string, unknown>
        expect(body.reachable).toBe(true)
    })

    test('onHealth runs inside request scope (identity() resolves)', async () => {
        const response = await fetchHealth({
            onHealth: () => ({ authed: identity().authenticated }),
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as Record<string, unknown>
        expect(body.authed).toBe(false)
    })
})
