import { describe, expect, test } from 'bun:test'
import { finalizeResponse } from '../src/lib/server/runtime/finalizeResponse.ts'
import type { RequestStore } from '../src/lib/server/runtime/types/RequestStore.ts'

// The finalize step only touches responseStreaming; the rest of the store is inert here.
function testStore(): RequestStore {
    return {} as RequestStore
}

const gzipRequest = new Request('http://x/', { headers: { 'accept-encoding': 'gzip' } })

describe('finalizeResponse', () => {
    test('a streaming body marks the store, exempts the idle timeout, and skips gzip', async () => {
        const store = testStore()
        let exempted = false
        const response = finalizeResponse(
            gzipRequest,
            new Response('{"a":1}\n', { headers: { 'content-type': 'application/jsonl' } }),
            store,
            () => {
                exempted = true
            },
        )
        expect(store.responseStreaming).toBe(true)
        expect(exempted).toBe(true)
        expect(response.headers.get('content-encoding')).toBeNull()
        expect(await response.text()).toBe('{"a":1}\n')
    })

    test('a compressible body gzips when accepted and leaves the idle timeout alone', () => {
        const store = testStore()
        let exempted = false
        const response = finalizeResponse(
            gzipRequest,
            new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
            store,
            () => {
                exempted = true
            },
        )
        expect(store.responseStreaming).toBe(false)
        expect(exempted).toBe(false)
        expect(response.headers.get('content-encoding')).toBe('gzip')
    })

    test('an opaque body passes through untouched', async () => {
        const store = testStore()
        const body = new Uint8Array([1, 2, 3])
        const response = finalizeResponse(
            gzipRequest,
            new Response(body, { headers: { 'content-type': 'image/png' } }),
            store,
            () => {},
        )
        expect(store.responseStreaming).toBe(false)
        expect(response.headers.get('content-encoding')).toBeNull()
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(body)
    })
})
