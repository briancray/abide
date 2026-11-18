// `fetchJson` AND `fetchText` against a service this file serves on a local port: what a fetch asks,
// how often, and what it settles to (54.7-54.17). No network — every address is this process's.

import { afterAll, expect, test } from 'bun:test'

import { fetchJson, fetchText } from '#server'

// Every path the service answers, to how many times it was asked.
const asked = new Map<string, number>()

const service = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
        const { pathname } = new URL(request.url)
        const count = (asked.get(pathname) ?? 0) + 1
        asked.set(pathname, count)
        if (pathname === '/flaky')
            return count < 3
                ? new Response('busy', { status: 503 })
                : Response.json({ name: 'Hopper & Co' })
        if (pathname === '/missing') return new Response('no', { status: 404 })
        if (pathname === '/slow-down')
            return new Response('later', {
                status: 429,
                headers: { 'retry-after': count < 2 ? '0' : '3600' },
            })
        if (pathname === '/stalled') {
            // The service taking its time, past any deadline these tests set.
            await Bun.sleep(500)
            return new Response('late')
        }
        if (pathname === '/held' || pathname === '/brief') {
            await Bun.sleep(20)
            return Response.json({ asked: count })
        }
        if (pathname === '/written') return new Response('', { status: 503 })
        if (pathname === '/not-json') return new Response('<html>')
        return Response.json({ name: 'Hopper & Co', employees: 'many' })
    },
})

afterAll(() => service.stop(true))

const at = (path: string) => `${service.url.origin}${path}`

// THE REVERT: return the failure at the first 503 rather than asking again, and the body reads a
// FetchFailed at 503.
test('a 503 is asked again, and the answer after it is the body — 54.8', async () => {
    expect(await fetchJson(at('/flaky'))).toEqual({ name: 'Hopper & Co' })
    expect(asked.get('/flaky')).toBe(3)
})

// THE REVERT: count every status transient in `asked`, and `/missing` is asked 3 times.
test('a 404 is answered at once, as a FetchFailed carrying the status — 54.8, 54.16', async () => {
    const answer = await fetchText(at('/missing'))
    expect(answer).toMatchObject({
        name: 'FetchFailed',
        status: 502,
        message: 'The service answered 404.',
        data: { status: 404, reason: 'status' },
    })
    expect(asked.get('/missing')).toBe(1)
})

test('a Retry-After is waited, and one past the deadline is not — 54.10', async () => {
    const answer = await fetchText(at('/slow-down'), { timeout: 1_000 })
    expect(answer).toMatchObject({ data: { status: 429, reason: 'status' } })
    // Asked again at once for `0`, then given up on for an hour.
    expect(asked.get('/slow-down')).toBe(2)
})

test('an attempt past its timeout is a FetchFailed for the timeout — 54.7', async () => {
    const answer = await fetchText(at('/stalled'), { timeout: 50, retries: 0 })
    expect(answer).toMatchObject({ data: { status: null, reason: 'timeout' } })
})

test('a service nobody answers for is a FetchFailed for the network — 54.16', async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response() })
    const origin = closed.url.origin
    await closed.stop(true)
    const answer = await fetchText(origin, { retries: 0 })
    expect(answer).toMatchObject({ data: { status: null, reason: 'network' } })
})

test("the caller's own abort is thrown, and nothing is asked again — 54.11", async () => {
    const leaving = new AbortController()
    const answer = fetchText(at('/stalled'), { signal: leaving.signal })
    leaving.abort(new Error('the caller left'))
    await expect(answer).rejects.toThrow('the caller left')
})

test('a write is not asked again unless `retries` says so — 54.9', async () => {
    const once = await fetchText(at('/written'), { method: 'POST', body: '' })
    expect(once).toMatchObject({ data: { status: 503 } })
    expect(asked.get('/written')).toBe(1)
    await fetchText(at('/written'), { method: 'POST', body: '', retries: 1 })
    expect(asked.get('/written')).toBe(3)
})

test('a body that is not JSON, or that the schema refuses, is a FetchFailed for its shape — 54.17', async () => {
    expect(await fetchJson(at('/not-json'))).toMatchObject({
        data: { status: null, reason: 'shape' },
    })
    const refused = await fetchJson(at('/company'), {
        schema: (value) => {
            const { employees } = value as { employees: unknown }
            if (typeof employees !== 'number') throw new Error('not a count')
            return { employees }
        },
    })
    expect(refused).toMatchObject({ data: { reason: 'shape' } })
    const accepted = await fetchText(at('/company'), {
        schema: (value) => String(value).toUpperCase(),
    })
    expect(accepted).toBe('{"NAME":"HOPPER & CO","EMPLOYEES":"MANY"}')
})

// THE REVERT: drop the in-flight entry, so each ask fetches, and `/held` is asked 5 times.
test('identical asks under a ttl are one request, and a held answer asks nothing — 54.12, 54.13', async () => {
    const answers = await Promise.all(
        Array.from({ length: 5 }, () =>
            fetchJson(at('/held'), { ttl: 60_000 }),
        ),
    )
    expect(answers).toEqual(Array(5).fill({ asked: 1 }))
    expect(await fetchJson(at('/held'), { ttl: 60_000 })).toEqual({ asked: 1 })
    expect(asked.get('/held')).toBe(1)
    // Other credentials are another answer.
    await fetchJson(at('/held'), {
        ttl: 60_000,
        headers: { authorization: 'Bearer theo' },
    })
    expect(asked.get('/held')).toBe(2)
})

test('a held answer past its ttl is asked again — 54.12', async () => {
    await fetchJson(at('/brief'), { ttl: 1 })
    // The clock passing the ttl: nothing settles as it does.
    await Bun.sleep(5)
    expect(await fetchJson(at('/brief'), { ttl: 1 })).toEqual({ asked: 2 })
})

// THE REVERT: keep a failure in `bodyOf`, and the second ask is answered from the cache — 2 asks.
test('a failure is not held, and the next ask runs again — 54.14', async () => {
    const before = asked.get('/missing') ?? 0
    await fetchText(at('/missing'), { ttl: 60_000 })
    await fetchText(at('/missing'), { ttl: 60_000 })
    expect((asked.get('/missing') ?? 0) - before).toBe(2)
})

test('a ttl on a POST holds nothing — 54.15', async () => {
    const before = asked.get('/held') ?? 0
    await fetchText(at('/held'), { method: 'POST', body: '', ttl: 60_000 })
    await fetchText(at('/held'), { method: 'POST', body: '', ttl: 60_000 })
    expect((asked.get('/held') ?? 0) - before).toBe(2)
})
