// 26.17, 41.21 — A BROWSER'S READ OF THE PRINCIPAL TAKES THE CALL THE PAGE ALREADY STARTED, as a
// handler's `wire` does, and fetches only where there is none. In this process nothing has imported
// `#server/principal.ts`, so `PRINCIPAL.document` is the browser's.
//
// THE REVERT: skip `takeEarlyCall` in the default; the first read fetches, and answers the fetched
// document rather than the one the page started.

import { expect, test } from 'bun:test'
import { HEALTH_ADDRESS, PRINCIPAL_ADDRESS } from '#shared/ADDRESSES.ts'
import { EARLY_CALLS } from '#shared/EARLY_CALLS.ts'
import { isFailed } from '#shared/Failed.ts'
import { HEALTH } from '#shared/health.ts'
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

// 26.23, 25.3 — A REFUSED SEED IS READ AS `wire` READS ONE, not parsed as the document. The early
// call was answered 502 by a proxy in front of the app, in text: `health` hands back the refusal
// the status is, so its value refuses (15.5), and the principal is the unauthenticated document
// carrying it (26.3, 26.10).
//
// THE REVERTS: parse `early.text` in `seededDocument` as it was, and both reads reject with a
// `SyntaxError` rather than answering; drop the principal's refusal arm, and its document is the
// `Failed` itself, `authenticated` undefined rather than false.
test('a refused seed is the refusal, and the principal it refuses is unauthenticated — 26.23, 25.3', async () => {
    const started: Record<string, unknown> = {}
    for (const address of [PRINCIPAL_ADDRESS, HEALTH_ADDRESS])
        started[rpcRequest('GET', address, undefined).key] = {
            status: 502,
            statusText: 'Bad Gateway',
            type: 'text/plain',
            version: null,
            life: null,
            text: 'Bad Gateway',
            body: undefined,
            promise: Promise.resolve(),
        }
    const globals = globalThis as unknown as Record<string, unknown>
    globals[EARLY_CALLS] = started
    try {
        const document = await PRINCIPAL.document()
        expect(document.authenticated).toBe(false)
        expect(isFailed(document.error)).toBe(true)
        expect(document.error?.status).toBe(502)
        const account = await HEALTH.report()
        expect(isFailed(account)).toBe(true)
        expect((account as { status: number }).status).toBe(502)
    } finally {
        globals[EARLY_CALLS] = undefined
    }
})
