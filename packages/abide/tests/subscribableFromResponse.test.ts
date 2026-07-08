import { describe, expect, test } from 'bun:test'
import { subscribableFromResponse } from '../src/lib/shared/subscribableFromResponse.ts'

/*
Builds a jsonl Response whose body enqueues `lines` once. `close` false keeps
the stream open so reader cancellation is the only way out — `onCancel`
observes it. Mirrors the long-lived HTTP stream fn.stream() consumes.
*/
function jsonlResponse(lines: string, options: { close?: boolean; onCancel?: () => void } = {}) {
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(lines))
            if (options.close ?? true) {
                controller.close()
            }
        },
        cancel() {
            options.onCancel?.()
        },
    })
    return new Response(body, { headers: { 'content-type': 'application/jsonl' } })
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = []
    for await (const value of iterable) {
        out.push(value)
    }
    return out
}

describe('subscribableFromResponse', () => {
    test('carries the name and yields the decoded frames', async () => {
        const subscribable = subscribableFromResponse<{ n: number }>('cache-key', async () =>
            jsonlResponse('{"n":1}\n{"n":2}\n'),
        )
        expect(subscribable.name).toBe('cache-key')
        expect(await collect(subscribable)).toEqual([{ n: 1 }, { n: 2 }])
    })

    test('defers the fetch until the first pull', async () => {
        let fetches = 0
        const subscribable = subscribableFromResponse<{ n: number }>('key', async () => {
            fetches += 1
            return jsonlResponse('{"n":1}\n')
        })
        const iterator = subscribable[Symbol.asyncIterator]()
        // Constructing the NamedAsyncIterable and its iterator opens nothing.
        expect(fetches).toBe(0)
        expect((await iterator.next()).value).toEqual({ n: 1 })
        expect(fetches).toBe(1)
    })

    test('each full iteration opens its own fetch', async () => {
        let fetches = 0
        const subscribable = subscribableFromResponse<{ n: number }>('key', async () => {
            fetches += 1
            return jsonlResponse('{"n":1}\n')
        })
        await collect(subscribable)
        await collect(subscribable)
        expect(fetches).toBe(2)
    })

    test('return() before any pull never fetches', async () => {
        let fetches = 0
        const subscribable = subscribableFromResponse('key', async () => {
            fetches += 1
            return jsonlResponse('{"n":1}\n')
        })
        const iterator = subscribable[Symbol.asyncIterator]()
        await iterator.return?.()
        expect((await iterator.next()).done).toBe(true)
        expect(fetches).toBe(0)
    })

    test('return() while the fetch is in flight settles the pending pull as done', async () => {
        let releaseFetch: (response: Response) => void = () => undefined
        const subscribable = subscribableFromResponse<{ n: number }>(
            'key',
            () =>
                new Promise<Response>((resolve) => {
                    releaseFetch = resolve
                }),
        )
        const iterator = subscribable[Symbol.asyncIterator]()
        const pending = iterator.next()
        await iterator.return?.()
        releaseFetch(jsonlResponse('{"n":1}\n', { close: false }))
        // The pull that raced the cancellation must not surface a frame.
        expect((await pending).done).toBe(true)
        expect((await iterator.next()).done).toBe(true)
    })

    test('return() mid-stream cancels the underlying body', async () => {
        let cancelled = false
        const subscribable = subscribableFromResponse<{ n: number }>('key', async () =>
            jsonlResponse('{"n":1}\n', {
                close: false,
                onCancel: () => {
                    cancelled = true
                },
            }),
        )
        const iterator = subscribable[Symbol.asyncIterator]()
        expect((await iterator.next()).value).toEqual({ n: 1 })
        await iterator.return?.()
        expect(cancelled).toBe(true)
    })
})
