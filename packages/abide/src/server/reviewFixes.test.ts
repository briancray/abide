// Regression guards for the transport/auth defects found in the whole-codebase review.
//
// Each of these was reproduced against a live app before the fix, and each fails for a DIFFERENT reason
// without its fix: a 500 where a 4xx belongs, an unbounded body, and a socket door that ran no gate.

import { describe, expect, test } from 'bun:test'
import { error } from '../server/error.ts'
import { GET } from '../server/GET.ts'
import { POST } from '../server/POST.ts'
import { socket } from '../server/socket.ts'
import { createTestApp } from '../test/createTestApp.ts'

describe('rpc name resolution is own-property only', () => {
    test('an Object.prototype name is a 404, not a 500', async () => {
        const app = await createTestApp({ routes: { hello: GET(() => ({ ok: true })) } })
        try {
            for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
                const response = await app.fetch(`/__abide/rpc/${name}`)
                expect([name, response.status]).toEqual([name, 404])
            }
        } finally {
            await app.stop()
        }
    })

    test('the method gate does not degrade to every verb on such a name', async () => {
        const app = await createTestApp({ routes: { hello: GET(() => ({ ok: true })) } })
        try {
            // Before the fix `allowedMethodsFor` saw no `__rpc` and returned ANY_RPC_METHOD, so a
            // mutation verb passed the gate on a name that is not an rpc at all — and reached a 500.
            const response = await app.fetch('/__abide/rpc/constructor', {
                method: 'DELETE',
                headers: { 'x-abide': '1' },
            })
            expect(response.status).toBe(404)
        } finally {
            await app.stop()
        }
    })
})

describe('malformed JSON on the wire is a 400', () => {
    test('a truncated __abide_args blob', async () => {
        const app = await createTestApp({ routes: { hello: GET(() => ({ ok: true })) } })
        try {
            const response = await app.fetch('/__abide/rpc/hello?__abide_args=%7B')
            expect(response.status).toBe(400)
        } finally {
            await app.stop()
        }
    })

    test('a malformed mutation body', async () => {
        const app = await createTestApp({ routes: { save: POST(() => ({ ok: true })) } })
        try {
            const response = await app.fetch('/__abide/rpc/save', {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: app.origin },
                body: '{oops',
            })
            expect(response.status).toBe(400)
        } finally {
            await app.stop()
        }
    })
})

describe('maxBodySize bounds a length-less multipart body', () => {
    test('a streamed multipart upload over the ceiling is a 413', async () => {
        const app = await createTestApp({
            routes: {
                upload: POST((form: FormData) => ({ size: (form.get('f') as File).size }), {
                    maxBodySize: 100,
                }),
            },
        })
        try {
            const boundary = '----abideReviewBoundary'
            const payload = `--${boundary}\r\nContent-Disposition: form-data; name="f"; filename="f.bin"\r\nContent-Type: application/octet-stream\r\n\r\n${'x'.repeat(200_000)}\r\n--${boundary}--\r\n`
            // A ReadableStream body declares no content-length, which is exactly the case that used to
            // skip both gates: the up-front check has nothing to read and `formData()` consumed the
            // stream before the post-buffer check could weigh it.
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(payload))
                    controller.close()
                },
            })
            const response = await app.fetch('/__abide/rpc/upload', {
                method: 'POST',
                headers: {
                    'content-type': `multipart/form-data; boundary=${boundary}`,
                    'x-abide': '1',
                },
                body,
                // @ts-expect-error — Bun/undici require this for a stream body.
                duplex: 'half',
            })
            expect(response.status).toBe(413)
        } finally {
            await app.stop()
        }
    })

    test('a streamed multipart upload under the ceiling still reaches the handler', async () => {
        const app = await createTestApp({
            routes: {
                upload: POST((form: FormData) => ({ size: (form.get('f') as File).size }), {
                    maxBodySize: 100_000,
                }),
            },
        })
        try {
            const boundary = '----abideReviewBoundary'
            const payload = `--${boundary}\r\nContent-Disposition: form-data; name="f"; filename="f.bin"\r\nContent-Type: application/octet-stream\r\n\r\n${'x'.repeat(1000)}\r\n--${boundary}--\r\n`
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(payload))
                    controller.close()
                },
            })
            const response = await app.fetch('/__abide/rpc/upload', {
                method: 'POST',
                headers: {
                    'content-type': `multipart/form-data; boundary=${boundary}`,
                    'x-abide': '1',
                },
                body,
                // @ts-expect-error — Bun/undici require this for a stream body.
                duplex: 'half',
            })
            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({ size: 1000 })
        } finally {
            await app.stop()
        }
    })
})

describe('MCP socket tools run the socket own middleware', () => {
    const mcpCall = (name: string, args?: unknown) => ({
        method: 'POST' as const,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: args },
        }),
    })

    test('a denying middleware refuses tail and publish', async () => {
        const alerts = socket<string>({
            clientPublish: true,
            channel: { tail: 10 },
            middleware: [() => error(403)],
        })
        const app = await createTestApp({ sockets: { alerts } })
        try {
            alerts.publish('SECRET-ALERT')

            const tail = await (await app.fetch('/__abide/mcp', mcpCall('alerts_tail'))).json()
            // A refusal is an ERROR tool-result, not a result — and it must not carry the transcript.
            expect(tail.result?.isError).toBe(true)
            expect(JSON.stringify(tail)).not.toContain('SECRET-ALERT')

            const published = await (
                await app.fetch('/__abide/mcp', mcpCall('alerts_publish', 'INJECTED'))
            ).json()
            expect(published.result?.isError).toBe(true)
            expect(alerts.__socket.tailSnapshot(undefined)).not.toContain('INJECTED')
        } finally {
            await app.stop()
        }
    })

    test('a socket with no middleware is still reachable', async () => {
        const feed = socket<string>({ clientPublish: true, channel: { tail: 10 } })
        const app = await createTestApp({ sockets: { feed } })
        try {
            feed.publish('hello')
            const tail = await (await app.fetch('/__abide/mcp', mcpCall('feed_tail'))).json()
            expect(tail.result?.isError).toBeFalsy()
            expect(JSON.stringify(tail)).toContain('hello')
        } finally {
            await app.stop()
        }
    })
})

describe('a Response is cloned only where a second reader can exist', () => {
    // `encodeRpcValue` cloned unconditionally. A `Response` body is single-consumption while a memo slot
    // is not, so a RETAINED one must be cloned per caller — but a memo-BYPASSING mutation has exactly one
    // consumer, and cloning there tees a stream whose other branch nobody reads. Measured streaming
    // 200 MB through the clone: +43 MB RSS held, against 0 MB uncloned.
    test('a memo:false mutation returning a Response is handed back whole', async () => {
        let built: Response | undefined
        const app = await createTestApp({
            routes: {
                download: POST(
                    () => {
                        built = new Response('payload', {
                            headers: { 'content-type': 'text/plain', 'x-custom': 'kept' },
                        })
                        return built
                    },
                    { memo: false },
                ),
            },
        })
        try {
            const response = await app.fetch('/__abide/rpc/download', {
                method: 'POST',
                headers: { 'x-abide': '1' },
            })
            expect(await response.text()).toBe('payload')
            // The handler's own headers still reach the caller — the escape hatch this branch exists for.
            expect(response.headers.get('x-custom')).toBe('kept')
            // Nothing was tee'd: the handler's Response IS what left, so its body is spent.
            expect(built?.bodyUsed).toBe(true)
        } finally {
            await app.stop()
        }
    })

    // The other half: a RETAINED Response is still re-readable by the next caller. Without the clone the
    // second read is `Body already used`.
    test('a retained read returning a Response serves every caller', async () => {
        const app = await createTestApp({
            routes: {
                doc: GET(() => new Response('body', { headers: { 'content-type': 'text/plain' } })),
            },
        })
        try {
            for (let i = 0; i < 3; i++) {
                const response = await app.fetch('/__abide/rpc/doc')
                expect([i, response.status, await response.text()]).toEqual([i, 200, 'body'])
            }
        } finally {
            await app.stop()
        }
    })
})
