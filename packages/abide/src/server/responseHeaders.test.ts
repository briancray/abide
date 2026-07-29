// Response-header hardening — baseline security headers, the default cache posture, CORS (the
// `crossOrigin` opt-in), the required `Allow` on a 405, and SSE stream headers.

import { afterEach, describe, expect, test } from 'bun:test'
import { CSRF_HEADER } from '../shared/internal/CSRF_HEADER.ts'
import { createTestApp } from '../test/createTestApp.ts'
import { GET } from './GET.ts'
import { POST } from './POST.ts'
import { sse } from './sse.ts'

const argsQuery = (value: unknown) => `?__abide_args=${encodeURIComponent(JSON.stringify(value))}`

describe('baseline hardening', () => {
    test('an RPC read carries nosniff + the private/no-cache default + Vary: Cookie', async () => {
        const app = await createTestApp({ routes: { ping: GET(() => ({ ok: true })) } })
        try {
            const response = await app.fetch(`/__abide/rpc/ping${argsQuery({})}`)
            expect(response.headers.get('x-content-type-options')).toBe('nosniff')
            expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
            expect(response.headers.get('cache-control')).toBe('private, no-cache')
            expect((response.headers.get('vary') ?? '').toLowerCase()).toContain('cookie')
            await response.text()
        } finally {
            await app.stop()
        }
    })

    test('an SSR HTML page carries X-Frame-Options SAMEORIGIN', async () => {
        const app = await createTestApp({ pages: { '/': '<h1>hi</h1>' } })
        try {
            const response = await app.fetch('/')
            expect(response.headers.get('content-type')).toContain('text/html')
            expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN')
            expect(response.headers.get('x-content-type-options')).toBe('nosniff')
            await response.text()
        } finally {
            await app.stop()
        }
    })
})

describe('405 Allow', () => {
    test('a GET to the POST-only MCP endpoint returns 405 with an Allow header', async () => {
        const app = await createTestApp({ routes: {} })
        try {
            const response = await app.fetch('/__abide/mcp', { method: 'GET' })
            expect(response.status).toBe(405)
            expect(response.headers.get('allow')).toBe('POST')
            await response.text()
        } finally {
            await app.stop()
        }
    })

    // The four TRANSPORT surfaces. `enforceMethod` consolidated the framework endpoints above and then
    // stopped: the rpc verb gate re-implemented the HEAD-rides-with-GET rule inline, and the socket
    // HTTP face, the public-file route and MCP each hand-rolled a 405 with its own `Allow` literal —
    // four private copies of the rule the helper exists to own. All four ask the gate now, so this
    // enumeration is what keeps the next transport surface from starting a fifth copy.
    test('an rpc enforces its DECLARED verb, and its Allow is derived from the declaration', async () => {
        const app = await createTestApp({
            routes: { read: GET(() => ({ ok: true })), write: POST(() => ({ ok: true })) },
        })
        try {
            // A mutation on a read is the CSRF hole `auth.md` §AU8 rests the SameSite=Lax argument on.
            const onRead = await app.fetch('/__abide/rpc/read', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-abide': '1' },
                body: '{}',
            })
            expect(onRead.status).toBe(405)
            expect(onRead.headers.get('allow')).toBe('GET, HEAD')
            await onRead.text()

            // A mutation advertises its bare verb — HEAD rides only with GET.
            const onWrite = await app.fetch(`/__abide/rpc/write${argsQuery({})}`)
            expect(onWrite.status).toBe(405)
            expect(onWrite.headers.get('allow')).toBe('POST')
            await onWrite.text()
        } finally {
            await app.stop()
        }
    })

    test('HEAD reaches a GET rpc — the router derives it, it is never declared', async () => {
        const app = await createTestApp({ routes: { read: GET(() => ({ ok: true })) } })
        try {
            const response = await app.fetch(`/__abide/rpc/read${argsQuery({})}`, {
                method: 'HEAD',
            })
            expect(response.status).toBe(200)
            await response.text()
        } finally {
            await app.stop()
        }
    })

    test('a public file is GET/HEAD only', async () => {
        const app = await createTestApp({ routes: {} })
        try {
            const response = await app.fetch('/robots.txt', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-abide': '1' },
                body: '{}',
            })
            // Either the file is absent (404) or the gate answers — never a 200 for a POST.
            expect(response.status).not.toBe(200)
            if (response.status === 405) expect(response.headers.get('allow')).toBe('GET, HEAD')
            await response.text()
        } finally {
            await app.stop()
        }
    })

    // Every read-only framework route, enumerated. Three of these — `/openapi.json`,
    // `/__abide/identity` and `/__abide/health` — answered a POST with a **200** and the document,
    // because the method gate was written out per route class (five times) while these three simply
    // never spelled it. `enforceMethod` is now the one gate; this is the list it has to cover, kept as
    // an enumeration precisely because the failure mode is a route class nobody remembered to check.
    // A POST carrying the abide client's shape clears the CSRF gate, so that is what it sends.
    //
    // PAGE SSR is on the list now because the enumeration missed it for the same reason the gate did:
    // both are lists. That branch hand-rolled the GET/HEAD comparison and let any other verb fall
    // through to the catch-all, so a matched page answered 404 with no `Allow`.
    test.each([
        ['/openapi.json'],
        ['/__abide/identity'],
        ['/__abide/health'],
        ['/__abide/logs'],
        ['/a-page'],
    ])('a POST to the read-only route %s is 405, not 200', async (path) => {
        const app = await createTestApp({
            routes: {},
            pages: { '/a-page': '<p>hi</p>' },
        })
        try {
            const response = await app.fetch(path, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-abide': '1' },
                body: '{}',
            })
            expect(response.status).toBe(405)
            // `HEAD` rides along with `GET` — the router derives it rather than accepting it (ADR 0027
            // D6), so a read-only route advertises both.
            expect(response.headers.get('allow')).toBe('GET, HEAD')
            await response.text()
        } finally {
            await app.stop()
        }
    })
})

describe('SSE stream headers', () => {
    test('an sse() stream is no-cache and disables proxy buffering', () => {
        const response = sse(
            (async function* () {
                yield 1
            })(),
        )
        expect(response.headers.get('content-type')).toBe('text/event-stream')
        expect(response.headers.get('cache-control')).toBe('no-cache')
        expect(response.headers.get('x-accel-buffering')).toBe('no')
    })
})

describe('CORS via crossOrigin', () => {
    const FOREIGN = 'https://foreign.example'

    afterEach(() => {
        delete Bun.env.APP_URL
    })

    test('a crossOrigin RPC answers the OPTIONS preflight and stamps the actual read', async () => {
        const app = await createTestApp({
            routes: { open: GET(() => ({ ok: true }), { crossOrigin: true }) },
        })
        try {
            const preflight = await app.fetch('/__abide/rpc/open', {
                method: 'OPTIONS',
                headers: { origin: FOREIGN, 'access-control-request-method': 'GET' },
            })
            expect(preflight.status).toBe(204)
            expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
            expect(preflight.headers.get('access-control-allow-methods')).toContain('GET')

            const read = await app.fetch(`/__abide/rpc/open${argsQuery({})}`, {
                headers: { origin: FOREIGN },
            })
            expect(read.headers.get('access-control-allow-origin')).toBe('*')
            await read.text()
        } finally {
            await app.stop()
        }
    })

    // THE CSRF HEADER AND THE ALLOWLIST ARE ONE FACT.
    //
    // `multipart/form-data` is a CORS "simple" content type a cross-site `<form>` CAN send, so a
    // multipart mutation is admitted by NOTHING but the `x-abide` header. That makes the gate that
    // demands it and the preflight allowlist that admits it two halves of one rule — and the allowlist
    // half fails quietly: every same-origin test clears the gate on `content-type: application/json`
    // and never consults it, so dropping the name there breaks only cross-origin callers, as a browser
    // CORS error whose cause lives in another file.
    //
    // Asserted against the CONSTANT, not a literal, so this cannot drift into agreeing with itself.
    test('a preflight advertises the CSRF header the gate demands', async () => {
        const app = await createTestApp({
            routes: { open: POST(() => ({ ok: true }), { crossOrigin: true }) },
        })
        try {
            const preflight = await app.fetch('/__abide/rpc/open', {
                method: 'OPTIONS',
                headers: {
                    origin: FOREIGN,
                    'access-control-request-method': 'POST',
                    'access-control-request-headers': CSRF_HEADER,
                },
            })
            expect(preflight.status).toBe(204)
            expect(preflight.headers.get('access-control-allow-headers')).toContain(CSRF_HEADER)

            // ...and the gate really does admit a multipart mutation on that header alone.
            const body = new FormData()
            body.set('field', 'value')
            const admitted = await app.fetch('/__abide/rpc/open', {
                method: 'POST',
                headers: { origin: FOREIGN, [CSRF_HEADER]: '1' },
                body,
            })
            expect(admitted.status).not.toBe(403)
            await admitted.text()

            // Without it, the same request is the CSRF rejection the header exists to gate.
            const rejected = await app.fetch('/__abide/rpc/open', {
                method: 'POST',
                headers: { origin: FOREIGN },
                body,
            })
            expect(rejected.status).toBe(403)
            await rejected.text()
        } finally {
            await app.stop()
        }
    })

    test('an OPTIONS to a same-origin-only RPC is 405 with Allow (no CORS)', async () => {
        const app = await createTestApp({ routes: { closed: GET(() => ({ ok: true })) } })
        try {
            const response = await app.fetch('/__abide/rpc/closed', {
                method: 'OPTIONS',
                headers: { origin: FOREIGN },
            })
            expect(response.status).toBe(405)
            expect(response.headers.get('allow')).toContain('GET')
            expect(response.headers.get('access-control-allow-origin')).toBeNull()
            await response.text()
        } finally {
            await app.stop()
        }
    })

    test('a foreign-origin mutation is CSRF-rejected unless crossOrigin admits the origin', async () => {
        Bun.env.APP_URL = 'https://app.example'
        const closedApp = await createTestApp({
            routes: { save: POST(() => ({ ok: true })) },
        })
        try {
            const rejected = await closedApp.fetch('/__abide/rpc/save', {
                method: 'POST',
                headers: { origin: FOREIGN, 'content-type': 'application/json' },
                body: '{}',
            })
            expect(rejected.status).toBe(403)
            await rejected.text()
        } finally {
            await closedApp.stop()
        }

        const openApp = await createTestApp({
            routes: { save: POST(() => ({ ok: true }), { crossOrigin: { origin: FOREIGN } }) },
        })
        try {
            const allowed = await openApp.fetch('/__abide/rpc/save', {
                method: 'POST',
                headers: { origin: FOREIGN, 'content-type': 'application/json' },
                body: '{}',
            })
            expect(allowed.status).toBe(200)
            expect(allowed.headers.get('access-control-allow-origin')).toBe(FOREIGN)
            expect((allowed.headers.get('vary') ?? '').toLowerCase()).toContain('origin')
            await allowed.text()
        } finally {
            await openApp.stop()
        }
    })

    // AU8.3 Referer fallback: when a browser omits `Origin` on a mutation, the check falls back to the
    // `Referer` header's origin (a full URL, reduced to its origin). Origin is preferred when present.
    test('a mutation with only a foreign Referer (no Origin) is CSRF-rejected', async () => {
        Bun.env.APP_URL = 'https://app.example'
        const app = await createTestApp({ routes: { save: POST(() => ({ ok: true })) } })
        try {
            const rejected = await app.fetch('/__abide/rpc/save', {
                method: 'POST',
                headers: { referer: `${FOREIGN}/some/page`, 'content-type': 'application/json' },
                body: '{}',
            })
            expect(rejected.status).toBe(403)
            await rejected.text()
        } finally {
            await app.stop()
        }
    })

    test('a mutation with a same-origin Referer (no Origin) is allowed', async () => {
        Bun.env.APP_URL = 'https://app.example'
        const app = await createTestApp({ routes: { save: POST(() => ({ ok: true })) } })
        try {
            const allowed = await app.fetch('/__abide/rpc/save', {
                method: 'POST',
                headers: {
                    referer: 'https://app.example/dashboard',
                    'content-type': 'application/json',
                },
                body: '{}',
            })
            expect(allowed.status).toBe(200)
            await allowed.text()
        } finally {
            await app.stop()
        }
    })

    test('a mutation with NEITHER Origin nor Referer is allowed (no-referrer must not break)', async () => {
        Bun.env.APP_URL = 'https://app.example'
        const app = await createTestApp({ routes: { save: POST(() => ({ ok: true })) } })
        try {
            const allowed = await app.fetch('/__abide/rpc/save', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            })
            expect(allowed.status).toBe(200)
            await allowed.text()
        } finally {
            await app.stop()
        }
    })

    test('Origin is preferred over Referer — a matching Origin admits despite a foreign Referer', async () => {
        Bun.env.APP_URL = 'https://app.example'
        const app = await createTestApp({ routes: { save: POST(() => ({ ok: true })) } })
        try {
            const allowed = await app.fetch('/__abide/rpc/save', {
                method: 'POST',
                headers: {
                    origin: 'https://app.example',
                    referer: `${FOREIGN}/page`,
                    'content-type': 'application/json',
                },
                body: '{}',
            })
            expect(allowed.status).toBe(200)
            await allowed.text()
        } finally {
            await app.stop()
        }
    })
})
