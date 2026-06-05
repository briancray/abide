import { describe, expect, test } from 'bun:test'
import type { AppModule } from '../src/lib/server/AppModule.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import type { CacheStore } from '../src/lib/shared/types/CacheStore.ts'

const options = { logRequests: false }

describe('runWithRequestScope', () => {
    test('runs the body inside a request scope reachable via the ALS store', async () => {
        const req = new Request('https://test.local/orders?id=1')
        let seen: { url: string; req: Request; cache: CacheStore } | undefined
        const response = await runWithRequestScope(req, options, async (store) => {
            // The body and anything it awaits see the same store the framework published.
            seen = { url: store.url.href, req: store.req, cache: store.cache }
            expect(requestContext.getStore()).toBe(store)
            return new Response('ok')
        })
        expect(await response.text()).toBe('ok')
        expect(seen?.url).toBe('https://test.local/orders?id=1')
        expect(seen?.req).toBe(req)
        expect(seen?.cache).toBeDefined()
    })

    test('gives each request its own cache store', async () => {
        const collect = (store: { cache: CacheStore }) => Promise.resolve(store.cache)
        const first = await runWithRequestScope(
            new Request('https://test.local/'),
            options,
            collect,
        )
        const second = await runWithRequestScope(
            new Request('https://test.local/'),
            options,
            collect,
        )
        // Isolation: a fresh store per request so cached calls never leak across requests.
        expect(first).not.toBe(second)
    })

    test('a thrown body with no handleError yields a generic framework 500 (no message leak)', async () => {
        const response = await runWithRequestScope(
            new Request('https://test.local/'),
            options,
            () => {
                throw new Error('boom')
            },
        )
        expect(response.status).toBe(500)
        expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
        const body = await response.text()
        // Secure by default: the error message/stack must not reach the client.
        expect(body).toBe('Internal Server Error')
        expect(body).not.toContain('boom')
    })

    test('DEBUG=belte opts the framework 500 into the full stack', async () => {
        const previous = process.env.DEBUG
        process.env.DEBUG = 'belte'
        try {
            const response = await runWithRequestScope(
                new Request('https://test.local/'),
                options,
                () => {
                    throw new Error('boom')
                },
            )
            expect(response.status).toBe(500)
            expect(await response.text()).toContain('boom')
        } finally {
            if (previous === undefined) {
                delete process.env.DEBUG
            } else {
                process.env.DEBUG = previous
            }
        }
    })

    test("a thrown body is routed to the app's handleError", async () => {
        const app: AppModule = {
            handleError: (error, request) =>
                new Response(
                    `handled ${(error as Error).message} for ${new URL(request.url).pathname}`,
                    {
                        status: 503,
                    },
                ),
        }
        const response = await runWithRequestScope(
            new Request('https://test.local/checkout'),
            { app, logRequests: false },
            () => {
                throw new Error('nope')
            },
        )
        expect(response.status).toBe(503)
        expect(await response.text()).toBe('handled nope for /checkout')
    })
})
