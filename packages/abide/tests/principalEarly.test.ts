// 26.17, 41.21 — A BROWSER'S READ OF THE PRINCIPAL TAKES THE CALL THE PAGE ALREADY STARTED, as a
// handler's `wire` does, and fetches only where there is none.
//
// THE REVERT: skip `takeEarlyCall` in the default; the first read fetches, and answers the fetched
// document rather than the one the page started.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { HEALTH_ADDRESS, PRINCIPAL_ADDRESS } from '#shared/ADDRESSES.ts'
import { answerOf } from '#shared/answerOf.ts'
import { EARLY_CALLS } from '#shared/EARLY_CALLS.ts'
import { isFailed } from '#shared/Failed.ts'
import { browserHealthReport, HEALTH } from '#shared/health.ts'
import { PRINCIPAL_HEADER } from '#shared/PRINCIPAL_HEADER.ts'
import {
    BROWSER_PRINCIPAL,
    PRINCIPAL,
    principal,
    principalMembers,
} from '#shared/principal.ts'
import { watch } from '#shared/reactive/index.ts'
import { rpcRequest } from '#shared/rpcRequest.ts'

// A BROWSER'S SLOTS, whatever ran first. A file in this process that imported `#server` swapped
// the server's resolver into `PRINCIPAL` and `HEALTH`, which a browser never does, and these reads
// then refuse as if they ran outside a request (22.1). THE REVERT: drop the pin; after
// `settle.test.ts` in one process all three fail.
const serverPrincipal = { ...PRINCIPAL }
const serverReport = HEALTH.report
beforeEach(() => {
    Object.assign(PRINCIPAL, BROWSER_PRINCIPAL)
    HEALTH.report = browserHealthReport
})
afterEach(() => {
    Object.assign(PRINCIPAL, serverPrincipal)
    HEALTH.report = serverReport
})

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
        return new Response('{"authenticated":false}', {
            headers: { 'content-type': 'application/json' },
        })
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

// 41.25, 41.27 — A SEED THE SERVER PAINTED SETTLED IS SETTLED WHEN THE PAGE ADOPTS, as `wire`'s is:
// hydration has already waited on `paintedCallsLanded()`, so a `principal` member read during setup
// is ready and a `{#if principal.authenticated.ready()}` region adopts the arm the server painted
// rather than its loading arm. `health`'s copy reads the same seed the same way.
//
// THE REVERT: `await` the answer in `seededDocument` unconditionally, as it was; every read below is
// in flight — `ready()` false, the document a `Promise` — though the answer is already there.
test('a seed painted settled is read settled, at once — 41.25, 41.27', () => {
    const settled = (text: string) => ({
        status: 200,
        statusText: 'OK',
        type: 'application/json',
        version: null,
        life: 'private, no-store',
        text,
        body: undefined,
        promise: Promise.resolve(),
        painted: 1,
    })
    const started: Record<string, unknown> = {}
    started[rpcRequest('GET', PRINCIPAL_ADDRESS, undefined).key] = settled(
        '{"authenticated":true,"name":"ada"}',
    )
    started[rpcRequest('GET', HEALTH_ADDRESS, undefined).key] = settled(
        '{"version":"1","abide":"1","startedAt":"now"}',
    )
    const globals = globalThis as unknown as Record<string, unknown>
    globals[EARLY_CALLS] = started
    try {
        expect(principal.authenticated.ready()).toBe(true)
        expect(principal.authenticated()).toBe(true)
        expect(HEALTH.report() as unknown).toEqual({
            version: '1',
            abide: '1',
            startedAt: 'now',
        })
    } finally {
        globals[EARLY_CALLS] = undefined
    }
})

// A HANDLER'S SIGN-IN MOVES A BROWSER'S `principal`, read by a component the call never named: the
// answer carries `PRINCIPAL_HEADER`, and the browser loads the document again under the cookie that
// answer set. Counted as the reader's wake-ups as well as the value — a reader that woke without a
// reload would still read `false`. THE REVERT: drop the `PRINCIPAL_HEADER` check in `answerOf`'s
// `fetched`; the principal is fetched 1 time where 2 are due, and reads `false` after the sign-in.
test("a handler's answer that signed the caller in reloads the browser's principal", async () => {
    let signedIn = false
    const fetched: string[] = []
    const fetchedBefore = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
        fetched.push(String(url))
        if (String(url) === PRINCIPAL_ADDRESS)
            return new Response(JSON.stringify({ authenticated: signedIn }), {
                headers: { 'content-type': 'application/json' },
            })
        signedIn = true
        return new Response('null', {
            headers: {
                'content-type': 'application/json',
                [PRINCIPAL_HEADER]: 'set',
            },
        })
    }) as typeof fetch
    // Whatever an earlier case here left the browser's one document holding.
    principalMembers().document.invalidate()
    const seen: boolean[] = []
    const stopWatching = watch(() => {
        if (principal.authenticated.ready())
            seen.push(principal.authenticated())
    })
    try {
        expect(await principal.authenticated).toBe(false)
        await answerOf(
            rpcRequest('POST', '/__abide/rpc/session/signIn', {}),
            false,
            undefined,
        )
        expect(await principal.authenticated).toBe(true)
        expect(fetched.filter((url) => url === PRINCIPAL_ADDRESS).length).toBe(
            2,
        )
        expect(seen.at(-1)).toBe(true)
    } finally {
        stopWatching()
        globalThis.fetch = fetchedBefore
    }
})

declare module '#shared/principal.ts' {
    interface Principal {
        id?: number
    }
}

// WHAT `onPrincipal` RESOLVES TO IS TYPED WHERE THE APP DECLARES IT, by merging into `Principal` as
// `Config` (27.12) and `Health` (25.4) take theirs, so `principal.resolved()` needs no cast. THE
// REVERTS: declare `Principal` as a type alias again, and the merge above is a second declaration of
// the name; type `resolved` as `Reactive<unknown>` again, and `.id` is read off `unknown` —
// `bun run typecheck` refuses this file either way.
test('a claim an app declares on Principal is typed where principal.resolved reads it', async () => {
    const fetchedBefore = globalThis.fetch
    globalThis.fetch = (async () =>
        new Response('{"authenticated":true,"id":7}', {
            headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch
    principalMembers().document.invalidate()
    try {
        const id: number | undefined = (await principal.resolved).id
        expect(id).toBe(7)
    } finally {
        globalThis.fetch = fetchedBefore
    }
})

// 7.4 — THE RELOAD A SIGN-IN STARTS KEEPS SERVING THE DOCUMENT IT REPLACES. A click handler reading
// `principal.authenticated()` while the reload is in flight reads the caller as they were, rather
// than throwing that the value has not landed. THE REVERT: have the listener `principalMembers` registers call
// `document.invalidate()` again; the read during the reload throws `NotLanded`.
test('a read while the sign-in reload is in flight answers the previous document — 7.4', async () => {
    let signedIn = false
    let landPrincipal = (): void => {}
    const fetchedBefore = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
        if (String(url) === PRINCIPAL_ADDRESS) {
            const body = JSON.stringify({ authenticated: signedIn })
            if (signedIn)
                await new Promise<void>((resolve) => {
                    landPrincipal = resolve
                })
            return new Response(body, {
                headers: { 'content-type': 'application/json' },
            })
        }
        signedIn = true
        return new Response('null', {
            headers: {
                'content-type': 'application/json',
                [PRINCIPAL_HEADER]: 'set',
            },
        })
    }) as typeof fetch
    principalMembers().document.invalidate()
    try {
        expect(await principal.authenticated).toBe(false)
        await answerOf(
            rpcRequest('POST', '/__abide/rpc/session/signIn', {}),
            false,
            undefined,
        )
        let during: unknown
        try {
            during = principal.authenticated()
        } catch (thrown) {
            during = thrown
        }
        expect(during).toBe(false)
        landPrincipal()
        expect(await principal.authenticated).toBe(true)
    } finally {
        globalThis.fetch = fetchedBefore
    }
})
