// The request pipeline: the ORDERED stage list every response leaves `fetch` through, and the
// declared-verb gate that guards it.
//
// This is the test the router did not have. Its absence is why four exit paths — the WS-upgrade
// reject, the CORS preflight, the CSRF rejection, and the first-load document — each ended up with a
// different subset of the stamping, and why a mutation stayed reachable over GET. Correctness tests
// on individual routes cannot catch that class of bug: each of those responses is individually
// well-formed. What has to be asserted is the pipeline's EXHAUSTIVENESS — that every way out of the
// handler passes the same stages — so the table below enumerates exit paths, not features.

import { describe, expect, test } from 'bun:test'
import { GET } from '../GET.ts'
import { POST } from '../POST.ts'
import { createApp } from './router.ts'

const read = GET(() => ({ ok: true }))
let mutationRuns = 0
const wipe = POST(() => {
    mutationRuns += 1
    return { wiped: true }
})
const openRead = GET(() => ({ ok: true }), { crossOrigin: { origin: 'https://friend.example' } })

async function withApp(run: (origin: string) => Promise<void>): Promise<void> {
    const app = createApp({ routes: { read, wipe, openRead }, pages: {} })
    try {
        await run(app.origin)
    } finally {
        await app.stop()
    }
}

describe('the declared verb is enforced, not just advertised', () => {
    test('a mutation is NOT reachable over GET', async () => {
        await withApp(async (origin) => {
            mutationRuns = 0
            const response = await fetch(`${origin}/__abide/rpc/wipe`)
            // The whole SameSite=Lax CSRF argument (auth.md AU8) rests on this: a top-level
            // cross-site GET still carries the identity cookie and skips `csrfReject`, so a mutation
            // answering GET is a CSRF hole regardless of how the handler was declared.
            expect(response.status).toBe(405)
            expect(mutationRuns).toBe(0)
            expect(response.headers.get('allow')).toBe('POST')
        })
    })

    test('a read is NOT reachable over POST', async () => {
        await withApp(async (origin) => {
            const response = await fetch(`${origin}/__abide/rpc/read`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            })
            expect(response.status).toBe(405)
            expect(response.headers.get('allow')).toBe('GET, HEAD')
        })
    })

    test('HEAD still reaches a GET rpc — the router DERIVES it (ADR 0027 D6)', async () => {
        await withApp(async (origin) => {
            const response = await fetch(`${origin}/__abide/rpc/read`, { method: 'HEAD' })
            expect(response.status).toBe(200)
        })
    })

    test('the declared verb still works', async () => {
        await withApp(async (origin) => {
            mutationRuns = 0
            const response = await fetch(`${origin}/__abide/rpc/wipe`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            })
            expect(response.status).toBe(200)
            expect(mutationRuns).toBe(1)
        })
    })
})

describe('every exit path carries a traceparent', () => {
    // One case per way out of `fetch`. A new route class that returns without going through `exit`
    // fails here rather than shipping a response that names no span.
    const exits: Array<{ what: string; go: (origin: string) => Promise<Response> }> = [
        { what: 'a normal read', go: (o) => fetch(`${o}/__abide/rpc/read`) },
        { what: 'a 404 nav', go: (o) => fetch(`${o}/nope`) },
        { what: 'an unknown rpc', go: (o) => fetch(`${o}/__abide/rpc/missing`) },
        {
            what: 'a 405 from the verb gate',
            go: (o) => fetch(`${o}/__abide/rpc/wipe`),
        },
        {
            what: 'a CSRF rejection',
            go: (o) =>
                fetch(`${o}/__abide/rpc/wipe`, {
                    method: 'POST',
                    headers: { 'content-type': 'text/plain' },
                    body: 'x',
                }),
        },
        {
            what: 'a CORS preflight',
            go: (o) =>
                fetch(`${o}/__abide/rpc/openRead`, {
                    method: 'OPTIONS',
                    headers: {
                        origin: 'https://friend.example',
                        'access-control-request-method': 'GET',
                    },
                }),
        },
        {
            what: 'an OPTIONS with no crossOrigin policy',
            go: (o) => fetch(`${o}/__abide/rpc/read`, { method: 'OPTIONS' }),
        },
        {
            what: 'a WS upgrade without an upgrade header',
            go: (o) => fetch(`${o}/__abide/sockets`),
        },
        { what: 'the health endpoint', go: (o) => fetch(`${o}/__abide/health`) },
        { what: 'the identity endpoint', go: (o) => fetch(`${o}/__abide/identity`) },
    ]

    for (const { what, go } of exits) {
        test(what, async () => {
            await withApp(async (origin) => {
                const response = await go(origin)
                expect(response.headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-/)
                expect(response.headers.get('traceresponse')).toBe(
                    response.headers.get('traceparent'),
                )
            })
        })
    }

    test('an incoming traceparent is propagated, not replaced', async () => {
        await withApp(async (origin) => {
            const incoming = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
            const response = await fetch(`${origin}/__abide/rpc/read`, {
                headers: { traceparent: incoming },
            })
            expect(response.headers.get('traceparent')).toBe(incoming)
        })
    })
})

describe('every exit path carries the baseline headers', () => {
    // `applyResponseHeaders` is the last stage; reaching it is the proof a response went through
    // `exit` rather than returning around it.
    test('a CSRF rejection is stamped', async () => {
        await withApp(async (origin) => {
            const response = await fetch(`${origin}/__abide/rpc/wipe`, {
                method: 'POST',
                headers: { 'content-type': 'text/plain' },
                body: 'x',
            })
            expect(response.status).toBe(403)
            expect(response.headers.get('x-content-type-options')).toBe('nosniff')
        })
    })

    test('a CSRF rejection to an admitted cross-origin caller still carries CORS', async () => {
        // Without the CORS stage the browser reports an opaque CORS failure and the app never sees
        // the 403 it was actually handed.
        await withApp(async (origin) => {
            const response = await fetch(`${origin}/__abide/rpc/openRead`, {
                method: 'DELETE',
                headers: { origin: 'https://friend.example', 'content-type': 'text/plain' },
                body: 'x',
            })
            expect(response.status).toBeGreaterThanOrEqual(400)
            expect(response.headers.get('access-control-allow-origin')).toBe(
                'https://friend.example',
            )
        })
    })
})

describe('a request body has a ceiling even when the rpc declares none', () => {
    test('ABIDE_MAX_REQUEST_BODY_SIZE is the default a per-rpc maxBodySize overrides', async () => {
        const previous = Bun.env.ABIDE_MAX_REQUEST_BODY_SIZE
        Bun.env.ABIDE_MAX_REQUEST_BODY_SIZE = '64'
        try {
            await withApp(async (origin) => {
                const response = await fetch(`${origin}/__abide/rpc/wipe`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ pad: 'x'.repeat(512) }),
                })
                expect(response.status).toBe(413)
            })
        } finally {
            if (previous === undefined) delete Bun.env.ABIDE_MAX_REQUEST_BODY_SIZE
            else Bun.env.ABIDE_MAX_REQUEST_BODY_SIZE = previous
        }
    })
})
