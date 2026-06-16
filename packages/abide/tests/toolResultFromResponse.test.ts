import { describe, expect, test } from 'bun:test'
import { toolResultFromResponse } from '../src/lib/mcp/toolResultFromResponse.ts'

describe('toolResultFromResponse', () => {
    test('object body becomes text + structuredContent', async () => {
        const result = await toolResultFromResponse(Response.json({ id: 1, name: 'a' }))
        expect(result.structuredContent).toEqual({ id: 1, name: 'a' })
        expect(result.content).toEqual([{ type: 'text', text: '{"id":1,"name":"a"}' }])
        expect(result.isError).toBeUndefined()
    })

    test('string body is text only (no structuredContent)', async () => {
        const result = await toolResultFromResponse(
            new Response('hello', { headers: { 'content-type': 'text/plain' } }),
        )
        expect(result.content).toEqual([{ type: 'text', text: 'hello' }])
        expect(result.structuredContent).toBeUndefined()
    })

    test('array body is text only (structuredContent must be an object)', async () => {
        const result = await toolResultFromResponse(Response.json([1, 2, 3]))
        expect(result.structuredContent).toBeUndefined()
        expect(result.content).toEqual([{ type: 'text', text: '[1,2,3]' }])
    })

    test('non-2xx is an error result', async () => {
        const result = await toolResultFromResponse(new Response('nope', { status: 404 }))
        expect(result.isError).toBe(true)
    })

    test('jsonl stream is drained into frames', async () => {
        const body = '{"n":1}\n{"n":2}\n{"n":3}\n'
        const result = await toolResultFromResponse(
            new Response(body, { headers: { 'content-type': 'application/jsonl' } }),
        )
        expect(result.structuredContent).toEqual({ frames: [{ n: 1 }, { n: 2 }, { n: 3 }] })
        expect(result.isError).toBeUndefined()
    })

    test('mid-stream error keeps frames-so-far and flags isError', async () => {
        const body = '{"n":1}\n{"$error":"boom"}\n'
        const result = await toolResultFromResponse(
            new Response(body, { headers: { 'content-type': 'application/x-ndjson' } }),
        )
        expect(result.isError).toBe(true)
        expect(result.structuredContent).toEqual({ frames: [{ n: 1 }] })
    })
})
