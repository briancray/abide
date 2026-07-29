// The route-class contract: WHERE each class's method gate lives, and why two of them are not out front.
//
// `RouteClass.methods` being a required member is what makes the gate structural — a class cannot skip it
// by not mentioning it, because there is nowhere to not mention it, and that much the compiler carries.
// What the compiler cannot carry is the ONE decision this arrangement makes: two classes return
// `GATE_IN_HANDLER` instead of a method list, because their 405 must follow a match that can 404.
//
// That asymmetry looks like an oversight, so it is exactly what a later tidy-up would "fix" by hoisting
// both gates to `dispatch` — and the damage would be quiet: `PUT /__abide/sockets/nope` would start
// answering 405 with `Allow: GET, POST` for a socket that does not exist, i.e. a header that says the name
// might be real. These tests pin the reason rather than the arrangement.

import { describe, expect, test } from 'bun:test'
import { createTestApp } from '../../test/createTestApp.ts'
import { GET } from '../GET.ts'
import { POST } from '../POST.ts'
import { socket } from '../socket.ts'

describe('a class that gates in its handler answers 404 before 405', () => {
    // An UNKNOWN name must not be told which verbs the framework serves. Both of these paths reach a real
    // route class (the prefix matched), so the gate is the only thing standing between the request and an
    // `Allow` header enumerating the verbs — which is why these two classes decline the front gate.
    //
    // THE VERB HAS TO SIT OUTSIDE THE CLASS'S OWN SET or this test proves nothing. `PROPFIND` is chosen for
    // that: an rpc route's front gate would be `allowedMethodsFor(undefined)` = the five verbs the
    // framework serves, so a `PUT` here is ADMITTED either way and 404s in the handler regardless of where
    // the gate sits. The first draft of this test used `PUT`, passed, and went on passing with the rpc
    // opt-out deleted. (Bun's `fetch` silently rewrites a non-HTTP method like `FROB` to `GET`, so the verb
    // also has to be a real one.)
    test.each([
        ['an unregistered rpc', '/__abide/rpc/nope'],
        ['an unknown socket name', '/__abide/sockets/nope'],
    ])('%s is 404, not 405 (its Allow would confirm the name might exist)', async (_what, path) => {
        const app = await createTestApp({
            routes: { real: GET(() => ({ ok: true })) },
            sockets: { realSocket: socket<string>() },
        })
        try {
            const response = await app.fetch(path, {
                method: 'PROPFIND',
                headers: { 'x-abide': '1' },
            })
            expect(response.status).toBe(404)
            expect(response.headers.get('allow')).toBeNull()
            await response.text()
        } finally {
            await app.stop()
        }
    })

    // The other half of the same decision: once the name IS real, the gate fires and carries `Allow`. Both
    // classes are checked, because "404 before 405" is only correct if 405 still happens.
    test('a KNOWN rpc reached with the wrong verb is 405 + its declared Allow', async () => {
        const app = await createTestApp({ routes: { write: POST(() => ({ ok: true })) } })
        try {
            const response = await app.fetch('/__abide/rpc/write', { method: 'GET' })
            expect(response.status).toBe(405)
            // The DECLARED verb, and only it — a mutation reachable over GET is a CSRF hole (auth.md
            // §AU8), so `HEAD` is not derived here the way it is for a read.
            expect(response.headers.get('allow')).toBe('POST')
            await response.text()
        } finally {
            await app.stop()
        }
    })

    test('a KNOWN socket reached with the wrong verb is 405 + Allow: GET, HEAD, POST', async () => {
        const app = await createTestApp({ sockets: { realSocket: socket<string>() } })
        try {
            const response = await app.fetch('/__abide/sockets/realSocket', {
                method: 'PUT',
                headers: { 'x-abide': '1' },
            })
            expect(response.status).toBe(405)
            // SSE subscribe on GET, publish on POST — and `HEAD` rides along with `GET`, derived by
            // `enforceMethod` rather than named (ADR 0027 D6).
            expect(response.headers.get('allow')).toBe('GET, HEAD, POST')
            await response.text()
        } finally {
            await app.stop()
        }
    })
})

// The chunk-asset class had a hand-rolled gate before `enforceMethod` reached it, and it is the one class
// that still reads the METHOD after the gate (to drop the body for HEAD while stating the Content-Length a
// GET would have returned). So it is the class where "gated out front" and "still verb-aware" have to hold
// at once.
test('the chunk-asset class is gated out front and still answers HEAD as GET-minus-body', async () => {
    const app = await createTestApp({ pages: { '/': '<p>hi</p>' } })
    try {
        const rejected = await app.fetch('/__abide/chunk/nope.js', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-abide': '1' },
            body: '{}',
        })
        expect(rejected.status).toBe(405)
        expect(rejected.headers.get('allow')).toBe('GET, HEAD')
        await rejected.text()

        // A HEAD for a chunk that does not exist still reaches the handler (the gate admits it) and 404s
        // there — proving the gate derived HEAD from GET rather than rejecting it.
        const missing = await app.fetch('/__abide/chunk/nope.js', { method: 'HEAD' })
        expect(missing.status).toBe(404)
        await missing.text()
    } finally {
        await app.stop()
    }
})
