// 23.10-23.13 — WHETHER A HOST ANSWERS AT ALL. `fetch` is stubbed, so each case names its own host:
// the answer is held per host for the process (23.12), and a host shared between cases would be
// answered from the first one's.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { reachable } from '#server/reachable.ts'

const unstubbedFetch = globalThis.fetch
const asked: { url: string; method: string | undefined }[] = []
let deadline: AbortSignal | null | undefined
let answer: () => Promise<Response> = async () => new Response(null)

beforeAll(() => {
    globalThis.fetch = ((url: string, init?: RequestInit) => {
        asked.push({ url, method: init?.method })
        deadline = init?.signal
        return answer()
    }) as unknown as typeof fetch
})

afterAll(() => {
    globalThis.fetch = unstubbedFetch
})

test('a host that answers is reachable whatever it answered — 23.10', async () => {
    answer = async () => new Response(null, { status: 500 })
    expect(await reachable('faulting.example')).toBe(true)
})

test('a host whose request fails is not — 23.11', async () => {
    answer = async () => {
        throw new Error('ConnectionRefused')
    }
    expect(await reachable('down.example')).toBe(false)
    // The 5 seconds are the request's own deadline, and its abort is a failure like any other.
    expect(deadline).toBeInstanceOf(AbortSignal)
})

// THE HOLDING IS WHAT IS GATED HERE; the minute is a keyed `ttl`'s, which is a timer and is gated
// with the reactive core. THE REVERT: probe in `reachable` itself rather than through the keyed
// value, and the second ask of one host fetches again — 1 -> 2 asked, and `true` -> `false`.
test("a host's answer is held, and another host is asked — 23.12", async () => {
    answer = async () => new Response(null)
    asked.length = 0
    expect(await reachable('held.example')).toBe(true)
    answer = async () => {
        throw new Error('ConnectionRefused')
    }
    expect(await reachable('held.example')).toBe(true)
    expect(asked.length).toBe(1)
    expect(await reachable('other.example')).toBe(false)
    expect(asked.length).toBe(2)
})

test('a bare host is asked over https and an origin as written, with HEAD — 23.13', async () => {
    answer = async () => new Response(null)
    asked.length = 0
    await reachable('bare.example')
    await reachable('http://billing.internal:8080')
    expect(asked).toEqual([
        { url: 'https://bare.example/', method: 'HEAD' },
        { url: 'http://billing.internal:8080', method: 'HEAD' },
    ])
})
