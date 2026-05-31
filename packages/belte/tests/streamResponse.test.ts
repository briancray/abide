import { describe, expect, test } from 'bun:test'
import { streamResponse } from '../src/lib/shared/streamResponse.ts'

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = []
    for await (const value of iterable) {
        out.push(value)
    }
    return out
}

describe('streamResponse', () => {
    test('parses SSE data frames as JSON', async () => {
        const body = 'data: {"n":1}\n\ndata: {"n":2}\n\n'
        const frames = await collect(
            streamResponse(
                new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
            ),
        )
        expect(frames).toEqual([{ n: 1 }, { n: 2 }])
    })

    test('SSE error frame throws mid-stream', async () => {
        const body = 'data: {"n":1}\n\nevent: error\ndata: {"message":"boom"}\n\n'
        const iterable = streamResponse(
            new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
        )
        await expect(collect(iterable)).rejects.toThrow('boom')
    })

    test('jsonl yields one value per line', async () => {
        const body = '{"a":1}\n{"a":2}\n'
        const frames = await collect(
            streamResponse(
                new Response(body, { headers: { 'content-type': 'application/jsonl' } }),
            ),
        )
        expect(frames).toEqual([{ a: 1 }, { a: 2 }])
    })

    test('non-streaming body is yielded once', async () => {
        const frames = await collect(streamResponse(Response.json({ ok: true })))
        expect(frames).toEqual([{ ok: true }])
    })

    test('non-2xx throws on first pull', async () => {
        const iterable = streamResponse(new Response('no', { status: 500 }))
        await expect(collect(iterable)).rejects.toThrow()
    })
})
