// `fetchAndHandle` against a service this file serves on a local port: what a fetch asks,
// how often, and what it settles to (54.7-54.13). No network — every address is this process's.

import { afterAll, expect, test } from 'bun:test'

import { fetchAndHandle } from '#server'
import { answered } from '#server/answerFailure.ts'
import { type Failed, problemOf } from '#shared/Failed.ts'
import type { FetchFailed } from '#shared/fetchFailed.ts'
import { handle } from '#shared/handle.ts'
import { refuse } from '#shared/refuse.ts'

/** `fetchAndHandle`'s answer, or the refusal it rejected with (54.12), as one value a test reads. */
const settledFetch = ((...given: Parameters<typeof fetchAndHandle>) =>
    fetchAndHandle(...given).catch(
        (refusal: unknown) => refusal,
    )) as unknown as (
    ...given: Parameters<typeof fetchAndHandle>
) => Promise<any>

// Every path the service answers, to how many times it was asked.
const asked = new Map<string, number>()

const service = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
        const { pathname } = new URL(request.url)
        const count = (asked.get(pathname) ?? 0) + 1
        asked.set(pathname, count)
        if (pathname === '/flaky' || pathname === '/flaky-again')
            return count < 3
                ? new Response('busy', { status: 503 })
                : Response.json({ name: 'Hopper & Co' })
        if (pathname === '/missing') return new Response('no', { status: 404 })
        if (pathname === '/no-route')
            return Response.json(
                { error: 'No path could be found for input' },
                { status: 422 },
            )
        if (pathname === '/long-refusal')
            return new Response('x'.repeat(70_000), { status: 422 })
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
        if (pathname === '/feed') {
            await Bun.sleep(20)
            return new Response('{"deal":1}\n{"deal":2}\n', {
                headers: { 'content-type': 'application/jsonl' },
            })
        }
        return Response.json({ name: 'Hopper & Co', employees: 'many' })
    },
})

afterAll(() => service.stop(true))

const at = (path: string) => `${service.url.origin}${path}`

// THE REVERT: return the failure at the first 503 rather than asking again, and the body reads a
// FetchFailed at 503.
test('a 503 is asked again, and the answer after it is the body — 54.8', async () => {
    expect(await settledFetch(at('/flaky'))).toEqual({ name: 'Hopper & Co' })
    expect(asked.get('/flaky')).toBe(3)
})

// 54.10 — THE WAIT BETWEEN ATTEMPTS IS A TIMER, on either side: a browser has no `Bun`, and a retry
// there waited through `Bun.sleep`. Asked here with `Bun.sleep` gone. THE REVERT: wait with
// `Bun.sleep` where no signal is given; the answer is a TypeError: `Bun.sleep is not a function`.
test('a retry with no signal waits by a timer, as a browser has no Bun — 54.10', async () => {
    const bunSleep = Bun.sleep
    ;(Bun as { sleep: unknown }).sleep = undefined
    try {
        const answer = await settledFetch(at('/flaky-again'), { backoff: 1 })
        expect(answer).toEqual({ name: 'Hopper & Co' })
    } finally {
        ;(Bun as { sleep: unknown }).sleep = bunSleep
    }
})

// THE REVERT: count every status transient in `asked`, and `/missing` is asked 3 times.
test('a 404 is answered at once, as a FetchFailed carrying the status — 54.8, 54.12', async () => {
    const answer = await settledFetch(at('/missing'))
    expect(answer).toMatchObject({
        name: 'FetchFailed',
        status: 502,
        message: 'The service answered 404.',
        data: { status: 404, reason: 'status' },
    })
    expect(asked.get('/missing')).toBe(1)
})

// 54.12 — A REFUSAL REJECTS, as a handler's call does (16.3), so `await` hands back the body alone and
// a `catch` is handed the `FetchFailed`. THE REVERT: return the refusal in `fetchAndHandle` rather than
// throwing it; the promise resolves, and `resolved` is what the test reads.
test('a refusal rejects the fetch with its FetchFailed — 54.12', async () => {
    const outcome = await fetchAndHandle(at('/missing')).then(
        () => 'resolved',
        (refusal: { name?: string; status?: number }) =>
            `${refusal.name} ${refusal.status}`,
    )
    expect(outcome).toBe('FetchFailed 502')
})

// 54.40 — A CAUGHT FAILURE IS NARROWED BY NAME, as a handler's is (`rpc.isError`): the fetch's own
// refusal is one, and anything else thrown is not. THE REVERT: answer `isFailed` alone in `isError`;
// the refusal of another name reads as one and `other: true`.
test('fetchAndHandle.isError narrows a caught failure to its FetchFailed — 54.40', async () => {
    const caught = await fetchAndHandle(at('/missing')).catch(
        (error: unknown) => error,
    )
    const status = fetchAndHandle.isError(caught, 'FetchFailed')
        ? caught.data.status
        : undefined
    const other = fetchAndHandle.isError(refuse(404), 'FetchFailed')
    expect(`status: ${status}, other: ${other}`).toBe(
        'status: 404, other: false',
    )
})

test('a Retry-After is waited, and one past the deadline is not — 54.10', async () => {
    const answer = await settledFetch(at('/slow-down'), { timeout: 1_000 })
    expect(answer).toMatchObject({ data: { status: 429, reason: 'status' } })
    // Asked again after the first step for `0`, then given up on for an hour.
    expect(asked.get('/slow-down')).toBe(2)
})

// A HANDLER HANDING ON WHAT A FETCH WAS REFUSED hands on the service's wait with it, whether
// `fetchAndHandle` asked or the app's own `fetch` read through `handle`. THE REVERT: drop the `holdUntil` in
// `refusedBy`; both answers carry `null` where `30` is due.
test("a refusal's Retry-After is held, and crosses the wire again — 15.23, 15.24", async () => {
    const asked = await settledFetch(at('/limited'))
    const read = await fetch(at('/limited')).then(handle)
    expect([
        answered(asked as FetchFailed).headers.get('retry-after'),
        answered(read as FetchFailed).headers.get('retry-after'),
    ]).toEqual(['30', '30'])
})

test('an attempt past its timeout is a FetchFailed for the timeout — 54.7', async () => {
    const answer = await settledFetch(at('/stalled'), {
        timeout: 50,
        retries: 0,
    })
    expect(answer).toMatchObject({ data: { status: null, reason: 'timeout' } })
})

test('a service nobody answers for is a FetchFailed for the network — 54.12', async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response() })
    const origin = closed.url.origin
    await closed.stop(true)
    const answer = await settledFetch(origin, { retries: 0 })
    expect(answer).toMatchObject({ data: { status: null, reason: 'network' } })
})

// THE REVERT: drop `cause`, and the refused connection is only 'network', its code lost.
test('a FetchFailed carries what fetch threw as its cause, and the wire carries none of it — 54.30', async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response() })
    const origin = closed.url.origin
    await closed.stop(true)
    const answer = await settledFetch(origin, { retries: 0 })
    const cause = (answer as Error).cause as { code?: string } | undefined
    expect(cause?.code).toBe('ECONNREFUSED')
    expect(
        JSON.stringify(problemOf(answer as Failed<string, unknown>)),
    ).not.toContain('ECONNREFUSED')
})

// THE REVERT: cancel a refused body unread, as `refusedBy` did — the service's own `error` is
// `undefined` where `No path could be found for input` is due.
test('a refused FetchFailed carries what the service said as its cause, and the wire carries none of it — 54.27, 54.30', async () => {
    const answer = await settledFetch(at('/no-route'), { retries: 0 })
    expect(answer).toMatchObject({ data: { status: 422, reason: 'status' } })
    expect((answer as Error).cause).toEqual({
        error: 'No path could be found for input',
    })
    expect(
        JSON.stringify(problemOf(answer as Failed<string, unknown>)),
    ).not.toContain('No path')
    const long = await settledFetch(at('/long-refusal'), { retries: 0 })
    expect(long).toMatchObject({ data: { status: 422, reason: 'status' } })
    expect((long as Error).cause).toBeUndefined()
})

test("the caller's own abort is thrown, and nothing is asked again — 54.11", async () => {
    const leaving = new AbortController()
    const answer = fetchAndHandle(at('/stalled'), { signal: leaving.signal })
    leaving.abort(new Error('the caller left'))
    await expect(answer).rejects.toThrow('the caller left')
})

test('a write is not asked again unless `retries` says so — 54.9', async () => {
    const once = await settledFetch(at('/written'), {
        method: 'POST',
        body: '',
    })
    expect(once).toMatchObject({ data: { status: 503 } })
    expect(asked.get('/written')).toBe(1)
    await settledFetch(at('/written'), { method: 'POST', body: '', retries: 1 })
    expect(asked.get('/written')).toBe(3)
})

test('a body that is not JSON, or that the schema refuses, is a FetchFailed for its shape — 54.13', async () => {
    expect(await settledFetch(at('/not-json'), { as: 'json' })).toMatchObject({
        data: { status: 200, reason: 'shape' },
    })
    const refused = await settledFetch(at('/company'), {
        schema: (value) => {
            const { employees } = value as { employees: unknown }
            if (typeof employees !== 'number') throw new Error('not a count')
            return { employees }
        },
    })
    expect(refused).toMatchObject({ data: { reason: 'shape' } })
    const accepted = await settledFetch(at('/company'), {
        as: 'text',
        schema: (value) => String(value).toUpperCase(),
    })
    expect(accepted).toBe('{"NAME":"HOPPER & CO","EMPLOYEES":"MANY"}')
})

// THE REVERT: read every 2xx as text in `asked`, and the JSON and the PNG are
// strings — `object` and `Blob` read `string` and `string`.
test('a body is read as its content-type says, as handle reads it — 54.13, 54.26, 54.29', async () => {
    const kinds = [
        await settledFetch(at('/company')),
        await settledFetch(at('/report.csv')),
        await settledFetch(at('/logo.png')),
    ].map((body) => (body instanceof Blob ? 'Blob' : typeof body))
    expect(kinds).toEqual(['object', 'string', 'Blob'])
})

// THE REVERT: drop `as` from `readBody`, and each is read as its type says — `object`, `string` and
// `object` where `string`, `Blob` and `object` are due, the last read from text/plain.
test('`as` reads the body as JSON, text or a Blob whatever its type says — 54.13', async () => {
    const kinds = [
        await settledFetch(at('/company'), { as: 'text' }),
        await settledFetch(at('/company'), { as: 'blob' }),
        await settledFetch(at('/plain-json'), { as: 'json' }),
    ].map((body) => (body instanceof Blob ? 'Blob' : typeof body))
    expect(kinds).toEqual(['string', 'Blob', 'object'])
})
