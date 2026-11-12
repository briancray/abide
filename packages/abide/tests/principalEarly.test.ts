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
import {
    BROWSER_PRINCIPAL,
    PRINCIPAL,
    principal,
    principalMembers,
} from '#shared/principal.ts'
import { PRINCIPAL_HEADER } from '#shared/PRINCIPAL_HEADER.ts'
import { reactive, watch } from '#shared/reactive/index.ts'
import { rpcRequest } from '#shared/rpcRequest.ts'
import { seededDocument } from '#shared/seededDocument.ts'

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
        promise: Promise.resolve(),
        painted: undefined,
        response: new Response('{"authenticated":true,"name":"ada"}', {
            headers: {
                'content-type': 'application/json',
                'cache-control': 'private, no-store',
            },
        }),
        bytes: undefined,
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
            promise: Promise.resolve(),
            painted: undefined,
            response: new Response('Bad Gateway', {
                status: 502,
                statusText: 'Bad Gateway',
                headers: { 'content-type': 'text/plain' },
            }),
            bytes: undefined,
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
    // Whatever an earlier file in this process left the one document holding, dropped before the
    // seed is there to be taken.
    principalMembers().document.invalidate()
    const settled = (text: string) => ({
        promise: Promise.resolve(),
        painted: 1,
        // Read to its end by the early-call script: the body is in `bytes`.
        response: new Response(null, {
            headers: { 'content-type': 'application/json' },
        }),
        bytes: new TextEncoder().encode(text).buffer,
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
// reload would still read `false`. THE REVERT: drop the `principalRotated` call in `answerOf`'s
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
            rpcRequest('POST', '/session/signIn', {}),
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
// than throwing that the value has not landed. THE REVERT: have `rotated` in `principalRotated.ts`
// call a bare `invalidate()` in place of `refreshCallerHeld()`; the read during the reload throws
// `NotLanded`.
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
            rpcRequest('POST', '/session/signIn', {}),
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

// 26.24 — A SIGN-IN MAKES EVERYTHING THE TAB HOLDS ANOTHER CALLER'S, so the tab that made the call
// reloads every value something reads, not only `principal` — here one the sign-in never named —
// and serves what it held until the reload lands (7.4). Once: the principal's own listener stands
// aside for the refresh that already reached it. THE REVERTS: drop `refreshCallerHeld()` from
// `rotated` in `principalRotated.ts`, and the inbox is loaded 1 time where 2 are due; have
// `principal.ts`'s listener refresh whatever `everything` says, and the principal is fetched 3 times
// where 2 are due.
test('a sign-in reloads every value the tab reads, serving the old one meanwhile — 26.24, 7.4', async () => {
    let caller = 'nobody'
    let landInbox = (): void => {}
    let loads = 0
    const inbox = reactive(async () => {
        loads += 1
        const reading = caller
        if (loads > 1)
            await new Promise<void>((resolve) => {
                landInbox = resolve
            })
        return `${reading}'s`
    })
    const seen: string[] = []
    const stopWatching = watch(() => {
        if (inbox.ready()) seen.push(inbox())
        if (principal.authenticated.ready()) principal.authenticated()
    })
    const fetched: string[] = []
    const fetchedBefore = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
        fetched.push(String(url))
        if (String(url) === PRINCIPAL_ADDRESS)
            return new Response(
                JSON.stringify({ authenticated: caller !== 'nobody' }),
                { headers: { 'content-type': 'application/json' } },
            )
        caller = 'ada'
        return new Response('null', {
            headers: {
                'content-type': 'application/json',
                [PRINCIPAL_HEADER]: 'set',
            },
        })
    }) as typeof fetch
    principalMembers().document.invalidate()
    try {
        expect(await inbox).toBe("nobody's")
        expect(await principal.authenticated).toBe(false)
        await answerOf(
            rpcRequest('POST', '/session/signIn', {}),
            false,
            undefined,
        )
        expect(`loads: ${loads}, during: ${inbox()}`).toBe(
            "loads: 2, during: nobody's",
        )
        landInbox()
        expect(await inbox).toBe("ada's")
        expect(seen.at(-1)).toBe("ada's")
        expect(await principal.authenticated).toBe(true)
        expect(
            `principal fetched: ${fetched.filter((url) => url === PRINCIPAL_ADDRESS).length}`,
        ).toBe('principal fetched: 2')
    } finally {
        stopWatching()
        globalThis.fetch = fetchedBefore
    }
})

// 26.24 — A `GET` THAT SIGNS IN RELOADS THE PRINCIPAL, AND NOTHING ELSE: a `GET` is what a refresh
// calls, so a value whose read answers the header every time would otherwise refresh everything,
// itself among it, without end. THE REVERT: have `principalRotated` refresh everything whatever the
// method; the verifying value is loaded until the case's own stop at 50, where 1 is due.
test('a GET that signs in reloads the principal and nothing else — 26.24', async () => {
    const fetchedBefore = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
        if (String(url) === PRINCIPAL_ADDRESS)
            return new Response('{"authenticated":true}', {
                headers: { 'content-type': 'application/json' },
            })
        return new Response('null', {
            headers: {
                'content-type': 'application/json',
                [PRINCIPAL_HEADER]: 'set',
            },
        })
    }) as typeof fetch
    principalMembers().document.invalidate()
    let loads = 0
    const verified = reactive(async () => {
        loads += 1
        // The revert's loop, stopped so it does not outlive the case.
        if (loads > 50) return loads
        await answerOf(
            rpcRequest('GET', '/session/verify', undefined),
            false,
            undefined,
        )
        return loads
    })
    const stopWatching = watch(() => {
        if (verified.ready()) verified()
        if (principal.authenticated.ready()) principal.authenticated()
    })
    try {
        await verified
        await Bun.sleep(20)
        expect(`loads: ${Math.min(loads, 50)}`).toBe('loads: 1')
        expect(await principal.authenticated).toBe(true)
    } finally {
        stopWatching()
        globalThis.fetch = fetchedBefore
    }
})

// 26.24 — ANOTHER TAB'S SIGN-IN IS HEARD AS THIS TAB'S OWN: everything this tab reads is reloaded on
// the channel's message, and nothing is sent back. THE REVERT: drop `refreshCallerHeld()` from
// `rotated`; the value is loaded 1 time where 2 are due.
test("another tab's sign-in reloads every value this tab reads — 26.24", async () => {
    let loads = 0
    const inbox = reactive(async () => {
        loads += 1
        return loads
    })
    const stopWatching = watch(() => {
        if (inbox.ready()) inbox()
    })
    // Opens this tab's channel, as reading `principal` does.
    principalMembers()
    const otherTab = new BroadcastChannel('abide:principal')
    let echoed = 0
    otherTab.onmessage = () => {
        echoed += 1
    }
    try {
        expect(await inbox).toBe(1)
        otherTab.postMessage('everything')
        await Bun.sleep(10)
        expect(`loads: ${loads}, echoed: ${echoed}`).toBe('loads: 2, echoed: 0')
    } finally {
        stopWatching()
        otherTab.close()
    }
})

// 13.6, 26.24 — A VALUE PAINTED SETTLED IS A LOAD ALL THE SAME: its body took the seed at once
// (41.27) and handed back no pending answer, yet the server painted it as the caller the page loaded
// as, and a sign-in reloads it with the rest. THE REVERT: drop `answeredAtOnce()` from `answerOf`;
// the bare refresh never reaches the value, and its address is fetched 0 times where 1 is due.
test('a value painted settled is reloaded by a sign-in — 13.6, 26.24', async () => {
    const address = '/account/getContact'
    const started: Record<string, unknown> = {}
    started[rpcRequest('GET', address, undefined).key] = {
        promise: Promise.resolve(),
        painted: 1,
        response: new Response(null, {
            headers: { 'content-type': 'application/json' },
        }),
        bytes: new TextEncoder().encode('{"dealValue":"admins only"}').buffer,
    }
    const globals = globalThis as unknown as Record<string, unknown>
    globals[EARLY_CALLS] = started
    const contact = reactive(() =>
        seededDocument<{ dealValue: string }>(address),
    )
    globals[EARLY_CALLS] = undefined
    const stopWatching = watch(() => {
        if (contact.ready()) contact()
    })
    const fetched: string[] = []
    const fetchedBefore = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
        fetched.push(String(url))
        if (String(url) === address)
            return new Response('{"dealValue":"$48,000"}', {
                headers: { 'content-type': 'application/json' },
            })
        return new Response('null', {
            headers: {
                'content-type': 'application/json',
                [PRINCIPAL_HEADER]: 'set',
            },
        })
    }) as typeof fetch
    try {
        expect(
            (contact() as { dealValue: string } | undefined)?.dealValue,
        ).toBe('admins only')
        await answerOf(
            rpcRequest('POST', '/session/signIn', {}),
            false,
            undefined,
        )
        expect(
            `fetched: ${fetched.filter((url) => url === address).length}`,
        ).toBe('fetched: 1')
        expect(((await contact) as { dealValue: string }).dealValue).toBe(
            '$48,000',
        )
    } finally {
        stopWatching()
        globalThis.fetch = fetchedBefore
    }
})

// 26.24, 11.34 — A `global` VALUE IS NO ONE CALLER'S, so a sign-in leaves it be while it reloads what
// this caller read: one cache for every caller holds nothing the new one makes stale. THE REVERT:
// drop the `global` test from `refreshCallerHeld`; the shared value is loaded 2 times where 1 is due.
test('a sign-in leaves a global value be — 26.24, 11.34', async () => {
    let sharedLoads = 0
    const shared = reactive(
        async () => {
            sharedLoads += 1
            return sharedLoads
        },
        { global: true },
    )
    let ownLoads = 0
    const own = reactive(async () => {
        ownLoads += 1
        return ownLoads
    })
    const stopWatching = watch(() => {
        if (shared.ready()) shared()
        if (own.ready()) own()
    })
    const fetchedBefore = globalThis.fetch
    globalThis.fetch = (async () =>
        new Response('null', {
            headers: {
                'content-type': 'application/json',
                [PRINCIPAL_HEADER]: 'set',
            },
        })) as unknown as typeof fetch
    try {
        await shared
        await own
        await answerOf(
            rpcRequest('POST', '/session/signIn', {}),
            false,
            undefined,
        )
        await own
        expect(`shared: ${sharedLoads}, own: ${ownLoads}`).toBe(
            'shared: 1, own: 2',
        )
    } finally {
        stopWatching()
        globalThis.fetch = fetchedBefore
    }
})
