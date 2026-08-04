// THE PIPELINE, WITHOUT A PORT. Every case here asserts a property of an EXIT PATH — the stamping a
// response picks up on its way out — which is what the 13-stage order exists to make uniform and what
// four route classes each got a different subset of before it was written down.
//
// None of these binds a socket. That is the point of the seam: `createTestApp` (a real `Bun.serve` on a
// real port, per `docs/spec/testing.md` TE1.1) remains the integration door and every existing test
// keeps using it; this is the second door, for the assertions that are about the pipeline itself rather
// than about the network.

import { describe, expect, test } from 'bun:test'
import { GET } from '../GET.ts'
import { POST } from '../POST.ts'
import type { AppConfig } from './appConfig.ts'
import { deriveRouterPolicy, handleRequest } from './handleRequest.ts'

// `srv` reaches only `makeRequestScope({ server })` and `srv.upgrade` on the WS branch, neither of which
// any case below exercises — so a stub is honest here rather than a mock standing in for behaviour.
const SERVER_STUB = {} as unknown as Parameters<typeof handleRequest>[1]

async function ask(config: AppConfig, request: Request): Promise<Response> {
    const response = await handleRequest(request, SERVER_STUB, config, deriveRouterPolicy(config))
    if (response === undefined) throw new Error('the pipeline consumed the request (WS upgrade)')
    return response
}

describe('the request pipeline', () => {
    test('a CSRF rejection carries the CORS headers of the rpc it was aimed at', async () => {
        // The regression this stage order was written for. Without the `cors` stage on THIS exit the
        // browser reports an opaque CORS failure instead of surfacing the 403 the server actually sent —
        // so the app looks broken rather than protected. A no-Origin mutation with no `x-abide` header
        // and no JSON content type fails the shape gate, which is the earliest CSRF exit there is.
        const config: AppConfig = {
            routes: {
                save: POST(() => ({ ok: true }), {
                    crossOrigin: { origin: 'https://friend.test' },
                }),
            },
        }
        const response = await ask(
            config,
            new Request('http://app.test/__abide/rpc/save', {
                method: 'POST',
                headers: { origin: 'https://friend.test', 'content-type': 'text/plain' },
                body: 'x',
            }),
        )

        expect(response.status).toBe(403)
        expect(response.headers.get('access-control-allow-origin')).toBe('https://friend.test')
    })

    test('every exit carries a traceparent, including one taken before the scope exists', async () => {
        // Stage 1 mints BEFORE stages 2 and 6 precisely so a pre-scope exit can still stamp it. A
        // preflight is the pre-scope exit that is easiest to reach.
        const config: AppConfig = {
            routes: { save: POST(() => ({ ok: true }), { crossOrigin: true }) },
        }
        const response = await ask(
            config,
            new Request('http://app.test/__abide/rpc/save', {
                method: 'OPTIONS',
                headers: { origin: 'https://any.test' },
            }),
        )

        expect(response.status).toBe(204)
        expect(response.headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/)
    })

    test('a well-formed incoming traceparent is propagated rather than replaced', async () => {
        const incoming = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
        const response = await ask(
            { routes: { ping: GET(() => ({ ok: true })) } },
            new Request('http://app.test/__abide/rpc/ping', { headers: { traceparent: incoming } }),
        )

        expect(response.headers.get('traceparent')).toBe(incoming)
        expect(response.headers.get('traceresponse')).toBe(incoming)
    })

    test('the declared verb is the method gate, and its 405 names the Allow', async () => {
        const response = await ask(
            { routes: { save: POST(() => ({ ok: true })) } },
            new Request('http://app.test/__abide/rpc/save'),
        )

        expect(response.status).toBe(405)
        expect(response.headers.get('allow')).toBe('POST')
    })

    test('baseline headers are stamped at the one exit, on a failure as well as a success', async () => {
        // Stage 13 runs for every response that leaves, which is the property that made four exit paths
        // differ before there was one exit.
        const config: AppConfig = { routes: { ping: GET(() => ({ ok: true })) } }
        const ok = await ask(config, new Request('http://app.test/__abide/rpc/ping'))
        const missing = await ask(config, new Request('http://app.test/nope'))

        expect(missing.status).toBe(404)
        for (const response of [ok, missing]) {
            expect(response.headers.get('x-content-type-options')).toBe('nosniff')
            expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
            expect(response.headers.get('traceparent')).not.toBeNull()
        }
    })

    test('an OPTIONS to an rpc that declared no crossOrigin is a 405, not a preflight', async () => {
        const response = await ask(
            { routes: { save: POST(() => ({ ok: true })) } },
            new Request('http://app.test/__abide/rpc/save', {
                method: 'OPTIONS',
                headers: { origin: 'https://any.test' },
            }),
        )

        expect(response.status).toBe(405)
        expect(response.headers.get('access-control-allow-origin')).toBeNull()
    })
})

describe('the per-kind policy table', () => {
    test("an rpc's own middleware runs on the HTTP door, ahead of arg validation", async () => {
        // The `route` rung: global + own, merged by `rpcChainFor`. A 403 must precede a 422, because the
        // chain wraps the WHOLE of dispatch — arg decoding included.
        const seen: string[] = []
        const config: AppConfig = {
            middleware: [
                (next): Response | Promise<Response> => {
                    seen.push('global')
                    return next()
                },
            ],
            routes: {
                secret: GET(() => ({ ok: true }), {
                    middleware: [
                        (): Response => {
                            seen.push('own')
                            return new Response('nope', { status: 403 })
                        },
                    ],
                }),
            },
        }
        const response = await ask(config, new Request('http://app.test/__abide/rpc/secret'))

        expect(response.status).toBe(403)
        expect(seen).toEqual(['global', 'own'])
    })

    test('a nav route draws the GLOBAL rung alone — no rpc entry exists to give it one', async () => {
        let ran = 0
        const config: AppConfig = {
            middleware: [
                (next): Response | Promise<Response> => {
                    ran += 1
                    return next()
                },
            ],
            routes: { ping: GET(() => ({ ok: true })) },
        }
        // No pages are registered, so this falls through to the router's 404 — after the global chain,
        // which is the rung the table assigns `nav`.
        const response = await ask(config, new Request('http://app.test/some/page'))

        expect(response.status).toBe(404)
        expect(ran).toBe(1)
    })

    test('a request whose NAME is not registered falls back to the global rung', async () => {
        // The fallback the table documents: a `route`-chained kind with no entry finds none and lands on
        // global. It must still reach dispatch, so the 404 comes from the handler and not from the chain.
        let ran = 0
        const config: AppConfig = {
            middleware: [
                (next): Response | Promise<Response> => {
                    ran += 1
                    return next()
                },
            ],
            routes: { ping: GET(() => ({ ok: true })) },
        }
        const response = await ask(config, new Request('http://app.test/__abide/rpc/absent'))

        expect(response.status).toBe(404)
        expect(ran).toBe(1)
    })
})
