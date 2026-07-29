// The app-level `onError` hook: the outermost net for an UNEXPECTED throw during request dispatch.
// A deliberate `error(...)`/`redirect(...)` also throws, but is rendered at its own status before this
// hook, so it never reaches onError — a declared 404 is not a bug in the app. The hook itself may shape
// the reply either way: by RETURNING a Response, or by calling `error(...)`, which throws.

import { describe, expect, test } from 'bun:test'
import { identity } from '../../shared/identity.ts'
import { error } from '../error.ts'
import { GET } from '../GET.ts'
import { request } from '../request.ts'
import { type AppConfig, createApp } from './router.ts'

// A read whose handler throws an unexpected error — the thing onError is meant to catch.
const boom = GET(() => {
    throw new Error('boom secret detail')
})

async function fetchBoom(onError?: AppConfig['onError'], init?: RequestInit): Promise<Response> {
    const app = createApp(
        onError !== undefined ? { routes: { boom }, onError } : { routes: { boom } },
    )
    try {
        return await fetch(`${app.origin}/__abide/rpc/boom`, init)
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

    // Regression: the onError response is finalized like a normal one — a throw during the request
    // must not skip the post-dispatch header stamping (identity cookie / CORS / trace). Prove it with
    // trace: an incoming traceparent should be echoed back on the error response too.
    test('the onError response is still stamped with the post-dispatch trace headers', async () => {
        const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
        const response = await fetchBoom(() => error(503, 'down'), {
            headers: { traceparent },
        })
        expect(response.status).toBe(503)
        expect(response.headers.get('traceresponse')).toBe(traceparent)
    })
})
