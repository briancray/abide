// 26.17, 41.21 — A BROWSER'S READ OF THE PRINCIPAL TAKES THE CALL THE PAGE ALREADY STARTED, as a
// handler's `wire` does, and fetches only where there is none. In this process nothing has imported
// `#server/principal.ts`, so `PRINCIPAL.document` is the browser's.
//
// THE REVERT: skip `takeEarlyCall` in the default; the first read fetches, and answers the fetched
// document rather than the one the page started.

import { expect, test } from 'bun:test'
import { PRINCIPAL_ADDRESS } from '#shared/ADDRESSES.ts'
import { EARLY_CALLS } from '#shared/EARLY_CALLS.ts'
import { PRINCIPAL } from '#shared/principal.ts'
import { rpcRequest } from '#shared/rpcRequest.ts'

test('the principal read takes the early call, once, and fetches after — 26.17, 41.21', async () => {
    const request = rpcRequest('GET', PRINCIPAL_ADDRESS, undefined)
    const started: Record<string, unknown> = {}
    started[request.key] = {
        status: 200,
        statusText: 'OK',
        type: 'application/json',
        version: null,
        life: 'private, no-store',
        text: '{"authenticated":true,"name":"ada"}',
        body: undefined,
        promise: Promise.resolve(),
    }
    const globals = globalThis as unknown as Record<string, unknown>
    globals[EARLY_CALLS] = started
    const fetchedBefore = globalThis.fetch
    const fetched: string[] = []
    globalThis.fetch = (async (url: string) => {
        fetched.push(String(url))
        return new Response('{"authenticated":false}')
    }) as typeof fetch
    try {
        expect(await PRINCIPAL.document()).toEqual({
            authenticated: true,
            name: 'ada',
        })
        expect(fetched).toEqual([])
        // Taken: the next read is a request of its own.
        expect(await PRINCIPAL.document()).toEqual({ authenticated: false })
        expect(fetched).toEqual([PRINCIPAL_ADDRESS])
    } finally {
        globalThis.fetch = fetchedBefore
        globals[EARLY_CALLS] = undefined
    }
})
