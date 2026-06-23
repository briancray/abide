import { describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
import { encodeRefJson } from '../src/lib/shared/encodeRefJson.ts'
import { REF_JSON_HEADER } from '../src/lib/shared/REF_JSON_HEADER.ts'

const JSON_HEADERS = { 'content-type': 'application/json' }
/* The abide client flags a ref-json body so the server decodes it with the matching codec. */
const REF_JSON_HEADERS = { ...JSON_HEADERS, [REF_JSON_HEADER]: '1' }

function postRequest(url: string, body: BodyInit, headers = JSON_HEADERS): Request {
    return new Request(`https://test.local${url}`, { method: 'POST', headers, body })
}

describe('maxBodySize', () => {
    test('a body under the limit parses and reaches the handler', async () => {
        const echo = defineVerb('POST', '/rpc/limit-ok', async (args) => json(args), {
            maxBodySize: 64,
        })
        const response = await echo.fetch(
            postRequest('/rpc/limit-ok', encodeRefJson({ name: 'ok' }), REF_JSON_HEADERS),
        )
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ name: 'ok' })
    })

    test('a declared Content-Length over the limit rejects with 413 before reading', async () => {
        const verb = defineVerb('POST', '/rpc/limit-header', async (args) => json(args), {
            maxBodySize: 8,
        })
        const response = await verb.fetch(
            postRequest('/rpc/limit-header', `{"data":"${'x'.repeat(64)}"}`),
        )
        expect(response.status).toBe(413)
        expect(await response.text()).toContain('maxBodySize (8 bytes)')
    })

    test('actual streamed bytes are bounded even without a Content-Length header', async () => {
        const verb = defineVerb('POST', '/rpc/limit-stream', async (args) => json(args), {
            maxBodySize: 16,
        })
        /* A stream body carries no Content-Length — the header check can't see it. */
        const oversized = new TextEncoder().encode(`{"data":"${'x'.repeat(64)}"}`)
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(oversized)
                controller.close()
            },
        })
        const response = await verb.fetch(postRequest('/rpc/limit-stream', body))
        expect(response.status).toBe(413)
    })

    test('without maxBodySize, no abide-level cap applies', async () => {
        const verb = defineVerb('POST', '/rpc/no-limit', async (args) => json(args))
        const response = await verb.fetch(
            postRequest(
                '/rpc/no-limit',
                encodeRefJson({ data: 'x'.repeat(4096) }),
                REF_JSON_HEADERS,
            ),
        )
        expect(response.status).toBe(200)
    })
})
