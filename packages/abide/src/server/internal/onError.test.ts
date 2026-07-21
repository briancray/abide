// The app-level `onError` hook: the outermost net for an unexpected throw during request dispatch.
// A typed error/redirect is a returned Response (not a throw) and never reaches onError.

import { describe, expect, test } from 'bun:test'
import { error } from '../error.ts'
import { GET } from '../GET.ts'
import { identity } from '../identity.ts'
import { request } from '../request.ts'
import { type AppConfig, createApp } from './router.ts'

// A read whose handler throws an unexpected error — the thing onError is meant to catch.
const boom = GET(() => {
    throw new Error('boom secret detail')
})

async function fetchBoom(onError?: AppConfig['onError']): Promise<Response> {
    const app = createApp(
        onError !== undefined ? { routes: { boom }, onError } : { routes: { boom } },
    )
    try {
        return await fetch(`${app.origin}/__abide/rpc/boom`)
    } finally {
        await app.stop()
    }
}

describe('onError', () => {
    test('without onError, an uncaught throw becomes a generic 500 that hides the detail', async () => {
        const response = await fetchBoom()
        expect(response.status).toBe(500)
        expect(await response.text()).not.toContain('boom secret detail')
    })

    test('a Response returned by onError shapes the client reply', async () => {
        const response = await fetchBoom(() => error(503, 'temporarily down'))
        expect(response.status).toBe(503)
        const body = (await response.json()) as Record<string, unknown>
        expect(body.message).toBe('temporarily down')
    })

    test('onError returning nothing falls back to the generic 500', async () => {
        const response = await fetchBoom(() => undefined)
        expect(response.status).toBe(500)
    })

    test('a throwing onError is itself caught and falls back to 500', async () => {
        const response = await fetchBoom(() => {
            throw new Error('hook blew up')
        })
        expect(response.status).toBe(500)
        expect(await response.text()).not.toContain('hook blew up')
    })

    test('onError runs inside request scope (request() + identity() are available ambiently)', async () => {
        const response = await fetchBoom(() =>
            error(500, `failed ${request().method} authed=${identity().authenticated}`),
        )
        expect(response.status).toBe(500)
        const body = (await response.json()) as Record<string, unknown>
        expect(body.message).toBe('failed GET authed=false')
    })
})
