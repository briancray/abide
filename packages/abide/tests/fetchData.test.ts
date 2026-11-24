// `fetchData` against a service this file serves on a local port: what a fetch asks,
// how often, and what it settles to (54.7-54.17). No network — every address is this process's.

import { afterAll, expect, test } from 'bun:test'

import { fetchData } from '#server'
import { answered } from '#server/answerFailure.ts'
import { type Failed, problemOf } from '#shared/Failed.ts'
import type { FetchFailed } from '#shared/fetchFailed.ts'
import { handle } from '#shared/handle.ts'

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
        if (pathname === '/limited')
            return new Response('later', {
                status: 429,
                headers: { 'retry-after': '30' },
            })
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
        if (pathname === '/report.csv')
            return new Response('name,deals\nada,3', {
                headers: { 'content-type': 'text/csv' },
            })
        if (pathname === '/logo.png')
            return new Response(new Uint8Array([137, 80, 78, 71]), {
                headers: { 'content-type': 'image/png' },
            })
        if (pathname === '/plain-json') return new Response('{"deals":3}')
        return Response.json({ name: 'Hopper & Co', employees: 'many' })
    },
})

afterAll(() => service.stop(true))

const at = (path: string) => `${service.url.origin}${path}`

// THE REVERT: return the failure at the first 503 rather than asking again, and the body reads a
// FetchFailed at 503.
test('a 503 is asked again, and the answer after it is the body — 54.8', async () => {
    expect(await fetchData(at('/flaky'))).toEqual({ name: 'Hopper & Co' })
    expect(asked.get('/flaky')).toBe(3)
})

// THE REVERT: count every status transient in `asked`, and `/missing` is asked 3 times.
test('a 404 is answered at once, as a FetchFailed carrying the status — 54.8, 54.16', async () => {
    const answer = await fetchData(at('/missing'))
    expect(answer).toMatchObject({
        name: 'FetchFailed',
        status: 502,
        message: 'The service answered 404.',
        data: { status: 404, reason: 'status' },
    })
    expect(asked.get('/missing')).toBe(1)
})

test('a Retry-After is waited, and one past the deadline is not — 54.10', async () => {
    const answer = await fetchData(at('/slow-down'), { timeout: 1_000 })
    expect(answer).toMatchObject({ data: { status: 429, reason: 'status' } })
    // Asked again after the first step for `0`, then given up on for an hour.
    expect(asked.get('/slow-down')).toBe(2)
})

// A HANDLER HANDING ON WHAT A FETCH WAS REFUSED hands on the service's wait with it, whether
// `fetchData` asked or the app's own `fetch` read through `handle`. THE REVERT: drop the `holdUntil` in
// `refusedBy`; both answers carry `null` where `30` is due.
test("a refusal's Retry-After is held, and crosses the wire again — 15.23, 15.24", async () => {
    const asked = await fetchData(at('/limited'))
    const read = await fetch(at('/limited')).then(handle)
    expect([
        answered(asked as FetchFailed).headers.get('retry-after'),
        answered(read as FetchFailed).headers.get('retry-after'),
    ]).toEqual(['30', '30'])
})

test('an attempt past its timeout is a FetchFailed for the timeout — 54.7', async () => {
    const answer = await fetchData(at('/stalled'), { timeout: 50, retries: 0 })
    expect(answer).toMatchObject({ data: { status: null, reason: 'timeout' } })
})

test('a service nobody answers for is a FetchFailed for the network — 54.16', async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response() })
    const origin = closed.url.origin
    await closed.stop(true)
    const answer = await fetchData(origin, { retries: 0 })
    expect(answer).toMatchObject({ data: { status: null, reason: 'network' } })
})

// THE REVERT: drop `cause`, and the refused connection is only 'network', its code lost.
test('a FetchFailed carries what fetch threw as its cause, and the wire carries none of it — 54.34', async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response() })
    const origin = closed.url.origin
    await closed.stop(true)
    const answer = await fetchData(origin, { retries: 0 })
    const cause = (answer as Error).cause as { code?: string } | undefined
    expect(cause?.code).toBe('ECONNREFUSED')
    expect(
        JSON.stringify(problemOf(answer as Failed<string, unknown>)),
    ).not.toContain('ECONNREFUSED')
})

test("the caller's own abort is thrown, and nothing is asked again — 54.11", async () => {
    const leaving = new AbortController()
    const answer = fetchData(at('/stalled'), { signal: leaving.signal })
    leaving.abort(new Error('the caller left'))
    await expect(answer).rejects.toThrow('the caller left')
})

test('a write is not asked again unless `retries` says so — 54.9', async () => {
    const once = await fetchData(at('/written'), { method: 'POST', body: '' })
    expect(once).toMatchObject({ data: { status: 503 } })
    expect(asked.get('/written')).toBe(1)
    await fetchData(at('/written'), { method: 'POST', body: '', retries: 1 })
    expect(asked.get('/written')).toBe(3)
})

test('a body that is not JSON, or that the schema refuses, is a FetchFailed for its shape — 54.17', async () => {
    expect(await fetchData(at('/not-json'), { as: 'json' })).toMatchObject({
        data: { status: 200, reason: 'shape' },
    })
    const refused = await fetchData(at('/company'), {
        schema: (value) => {
            const { employees } = value as { employees: unknown }
            if (typeof employees !== 'number') throw new Error('not a count')
            return { employees }
        },
    })
    expect(refused).toMatchObject({ data: { reason: 'shape' } })
    const accepted = await fetchData(at('/company'), {
        as: 'text',
        schema: (value) => String(value).toUpperCase(),
    })
    expect(accepted).toBe('{"NAME":"HOPPER & CO","EMPLOYEES":"MANY"}')
})

// THE REVERT: read every 2xx as text in `asked`, and the JSON and the PNG are
// strings — `object` and `Blob` read `string` and `string`.
test('a body is read as its content-type says, as handle reads it — 54.17, 54.30, 54.33', async () => {
    const kinds = [
        await fetchData(at('/company')),
        await fetchData(at('/report.csv')),
        await fetchData(at('/logo.png')),
    ].map((body) => (body instanceof Blob ? 'Blob' : typeof body))
    expect(kinds).toEqual(['object', 'string', 'Blob'])
})

// THE REVERT: drop `as` from `readBody`, and each is read as its type says — `object`, `string` and
// `object` where `string`, `Blob` and `object` are due, the last read from text/plain.
test('`as` reads the body as JSON, text or a Blob whatever its type says — 54.17', async () => {
    const kinds = [
        await fetchData(at('/company'), { as: 'text' }),
        await fetchData(at('/company'), { as: 'blob' }),
        await fetchData(at('/plain-json'), { as: 'json' }),
    ].map((body) => (body instanceof Blob ? 'Blob' : typeof body))
    expect(kinds).toEqual(['string', 'Blob', 'object'])
})

// THE REVERT: key a held answer by its URL and headers alone, and the JSON reading is answered with
// the text one held — `string` where `object` is due.
test('one URL read two ways under a ttl is two answers — 54.12', async () => {
    await fetchData(at('/held-twice'), { as: 'text', ttl: 60_000 })
    const parsed = await fetchData(at('/held-twice'), { ttl: 60_000 })
    expect(typeof parsed).toBe('object')
})

// THE REVERT: drop the in-flight entry, so each ask fetches, and `/held` is asked 5 times.
test('identical asks under a ttl are one request, and a held answer asks nothing — 54.12, 54.13', async () => {
    const answers = await Promise.all(
        Array.from({ length: 5 }, () =>
            fetchData(at('/held'), { ttl: 60_000 }),
        ),
    )
    expect(answers).toEqual(Array(5).fill({ asked: 1 }))
    expect(await fetchData(at('/held'), { ttl: 60_000 })).toEqual({ asked: 1 })
    expect(asked.get('/held')).toBe(1)
    // Other credentials are another answer.
    await fetchData(at('/held'), {
        ttl: 60_000,
        headers: { authorization: 'Bearer theo' },
    })
    expect(asked.get('/held')).toBe(2)
})

test('a held answer past its ttl is asked again — 54.12', async () => {
    await fetchData(at('/brief'), { ttl: 1 })
    // The clock passing the ttl: nothing settles as it does.
    await Bun.sleep(5)
    expect(await fetchData(at('/brief'), { ttl: 1 })).toEqual({ asked: 2 })
})

// THE REVERT: keep a failure in `bodyOf`, and the second ask is answered from the cache — 2 asks.
test('a failure is not held, and the next ask runs again — 54.14', async () => {
    const before = asked.get('/missing') ?? 0
    await fetchData(at('/missing'), { ttl: 60_000 })
    await fetchData(at('/missing'), { ttl: 60_000 })
    expect((asked.get('/missing') ?? 0) - before).toBe(2)
})

test('a ttl on a POST holds nothing — 54.15', async () => {
    const before = asked.get('/held') ?? 0
    await fetchData(at('/held'), { method: 'POST', body: '', ttl: 60_000 })
    await fetchData(at('/held'), { method: 'POST', body: '', ttl: 60_000 })
    expect((asked.get('/held') ?? 0) - before).toBe(2)
})
