import { describe, expect, test } from 'bun:test'
import { resolveStreamResponse } from '../src/lib/server/runtime/resolveStreamResponse.ts'
import { stashPendingStream, takePendingStream } from '../src/lib/server/runtime/streamStash.ts'
import type { CacheEntry } from '../src/lib/shared/types/CacheEntry.ts'
import type { CacheStore } from '../src/lib/shared/types/CacheStore.ts'

function storeWith(entries: CacheEntry[]): CacheStore {
    return {
        entries: new Map(entries.map((entry) => [entry.key, entry])),
        events: new EventTarget(),
        subscribe: () => {},
        trackLifecycle: () => {},
        markLifecycle: () => {},
        pendingRefresh: new Set(),
        stats: { hits: 0, misses: 0, coalesced: 0 },
    }
}

function pendingEntry(key: string, delay: number, body: unknown): CacheEntry {
    return {
        key,
        promise: new Promise<Response>((resolve) =>
            setTimeout(() => resolve(Response.json(body)), delay),
        ),
        request: new Request(`https://test.local/rpc/${key}`, { method: 'GET' }),
        ttl: undefined,
        expiresAt: undefined,
        settled: false,
    }
}

describe('streamStash', () => {
    test('take returns the stash once, then nothing (single-use)', () => {
        const store = storeWith([])
        const token = stashPendingStream(store, [])
        expect(takePendingStream(token)?.store).toBe(store)
        expect(takePendingStream(token)).toBeUndefined()
    })

    test('unknown token returns undefined', () => {
        expect(takePendingStream('nope')).toBeUndefined()
    })
})

describe('resolveStreamResponse', () => {
    test('404 for a missing/expired token', () => {
        expect(resolveStreamResponse('missing').status).toBe(404)
    })

    test('streams newline-delimited resolutions in resolution order', async () => {
        const slow = pendingEntry('slow', 40, { n: 'slow' })
        const fast = pendingEntry('fast', 5, { n: 'fast' })
        const token = stashPendingStream(storeWith([slow, fast]), [slow, fast])

        const response = resolveStreamResponse(token)
        expect(response.headers.get('content-type')).toBe('application/x-ndjson')

        const lines = (await response.text())
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        // fast (5ms) lands before slow (40ms); each carries its decoded body.
        expect(lines.map((r) => r.key)).toEqual(['fast', 'slow'])
        expect(lines[0].body).toBe(JSON.stringify({ n: 'fast' }))
    })

    test('a non-snapshottable body streams a miss marker', async () => {
        const binary = pendingEntry('bin', 0, null)
        binary.promise = Promise.resolve(new Response(new Uint8Array([1, 2, 3])))
        const token = stashPendingStream(storeWith([binary]), [binary])

        const lines = (await resolveStreamResponse(token).text())
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        expect(lines).toEqual([{ key: 'bin', miss: true }])
    })
})
