// The nav-response classification, tested directly. Before it had an owner this rule was three inline
// spellings in `navigate.ts` reachable only by driving a full soft-nav against a fake `fetch` — so the
// ordering constraint that makes it correct (jsonl BEFORE json) had no test at all, in any of the three.

import { describe, expect, test } from 'bun:test'
import { classifyNavResponse } from './navResponse.ts'

function respond(body: string | null, contentType: string | null): Response {
    const headers = contentType === null ? undefined : { 'content-type': contentType }
    return new Response(body, headers === undefined ? {} : { headers })
}

describe('classifyNavResponse', () => {
    test('a jsonl frame stream is a stream, and its body is handed on undrained', async () => {
        const response = respond('{"kind":"shell"}\n', 'application/jsonl')
        const classified = await classifyNavResponse(response)
        expect(classified.kind).toBe('stream')
        if (classified.kind !== 'stream') throw new Error('unreachable')
        expect(await new Response(classified.body).text()).toBe('{"kind":"shell"}\n')
    })

    // THE REGRESSION THAT MATTERS: "application/jsonl" contains "application/json" as a substring, so a
    // classifier that asks about `json` first reads the frame stream as a redirect envelope. Note what
    // that does and does not break — the envelope parses, names no `redirect`, and the ladder falls
    // through to the stream verdict, so the KIND is still right and only the BODY is gone. Asserting the
    // body is still readable is therefore the assertion that fails when the order is wrong; a
    // kind-only test passes over the bug.
    test('a jsonl stream is never read as a redirect envelope', async () => {
        for (const contentType of [
            'application/jsonl',
            'application/jsonl; charset=utf-8',
            'application/jsonl;charset=utf-8',
        ]) {
            const classified = await classifyNavResponse(respond('{"kind":"seed"}\n', contentType))
            expect(classified.kind).toBe('stream')
            if (classified.kind !== 'stream') throw new Error('unreachable')
            expect(classified.body.locked).toBe(false)
            expect(await new Response(classified.body).text()).toBe('{"kind":"seed"}\n')
        }
    })

    test('a json envelope naming a redirect is a redirect', async () => {
        const classified = await classifyNavResponse(
            respond('{"redirect":"/login"}', 'application/json'),
        )
        expect(classified).toEqual({ kind: 'redirect', to: '/login' })
    })

    test('a json envelope naming no redirect is unusable', async () => {
        expect((await classifyNavResponse(respond('{}', 'application/json'))).kind).toBe('unusable')
    })

    // An empty string is not a destination. Both of the old spellings tested `.length > 0` for this;
    // the third tested `typeof === 'string'` as well, which is the check that survives here.
    test('a redirect that is empty or not a string is unusable', async () => {
        for (const body of ['{"redirect":""}', '{"redirect":123}', '{"redirect":null}']) {
            expect((await classifyNavResponse(respond(body, 'application/json'))).kind).toBe(
                'unusable',
            )
        }
    })

    test('malformed JSON is unusable rather than a throw', async () => {
        const classified = await classifyNavResponse(respond('{not json', 'application/json'))
        expect(classified.kind).toBe('unusable')
    })

    test('an HTML document (a hard error page) is unusable', async () => {
        const classified = await classifyNavResponse(respond('<!doctype html>', 'text/html'))
        expect(classified.kind).toBe('unusable')
    })

    test('a response with no content-type is unusable', async () => {
        // `new Response(body)` stamps text/plain, so name the absence explicitly.
        const bare = new Response('x')
        bare.headers.delete('content-type')
        expect((await classifyNavResponse(bare)).kind).toBe('unusable')
    })

    // A 304/204 carrying the frame-stream content type has nothing to drain. The `stream` verdict
    // promises a non-null body, so this must not become one.
    test('a jsonl response with no body is unusable', async () => {
        const bodyless = new Response(null, {
            status: 204,
            headers: { 'content-type': 'application/jsonl' },
        })
        expect((await classifyNavResponse(bodyless)).kind).toBe('unusable')
    })
})
