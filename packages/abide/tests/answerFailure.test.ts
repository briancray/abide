import { expect, test } from 'bun:test'

import { answered, answerFailure } from '#server/answerFailure.ts'
import { plainAnswer } from '#server/plainAnswer.ts'
import { inReleasedScope } from '#server/requestScope.ts'
import { answered as answeredValue, answerFrom } from '#shared/answerOf.ts'
import { holdUntil, retryAt } from '#shared/Failed.ts'
import { refuse } from '#shared/refuse.ts'
import { parseRoutePattern } from '#shared/routePattern.ts'

// 15.1, 21.3, 21.7 — A HANDLER'S LANE answers a refusal as Problem Details (RFC 9457), at its own
// status: an undeclared one is `about:blank`, titled by its reason phrase, its message the detail.
test('the handler lane answers a refusal as Problem Details at its status — 15.1', async () => {
    const answer = answered(refuse(403, 'no'))
    expect(answer.status).toBe(403)
    expect(answer.headers.get('content-type')).toBe('application/problem+json')
    expect(answer.headers.get('cache-control')).toBe('private, no-store')
    expect(answer.headers.get('vary')).toBe('origin')
    expect(await answer.json()).toEqual({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: 'no',
    })
})

// 15.24 — A REFUSAL'S Retry-After CROSSES EVERY WIRE IT CROSSES. Read off an answer, it stays with
// the refusal rebuilt from it; answered again — a handler handing on what a call it made refused —
// it is a header again, naming what is left of the same wait. THE REVERT: drop the `retry-after`
// write from `answered`; the second answer carries `null` where `30` is due.
test('a refusal answered with a Retry-After carries it again — 15.24', async () => {
    const rebuiltFrom = async (retryAfter: string) =>
        answeredValue(
            await answerFrom(
                new Response(
                    JSON.stringify({
                        type: 'about:blank',
                        title: 'Too Many Requests',
                        status: 429,
                        detail: 'later',
                    }),
                    {
                        status: 429,
                        headers: {
                            'content-type': 'application/problem+json',
                            'retry-after': retryAfter,
                        },
                    },
                ),
                undefined,
                false,
            ),
            { method: 'GET', url: '/limited' },
        ) as ReturnType<typeof refuse>
    const rebuilt = await rebuiltFrom('30')
    expect(Math.round(((retryAt(rebuilt) as number) - Date.now()) / 1000)).toBe(
        30,
    )
    expect(answered(rebuilt).headers.get('retry-after')).toBe('30')
    // An HTTP date names the same kind of time.
    const dated = await rebuiltFrom(new Date(Date.now() + 60_000).toUTCString())
    const again = Number(answered(dated).headers.get('retry-after'))
    expect(again).toBeGreaterThan(57)
    expect(again).toBeLessThanOrEqual(60)
    // Kept beside the refusal, so one answered with none answers with none.
    const plain = refuse(429)
    expect(answered(plain).headers.get('retry-after')).toBe(null)
    holdUntil(plain, Date.now() + 5_000)
    expect(answered(plain).headers.get('retry-after')).toBe('5')
})

// 21.3 — ABIDE'S OWN ADDRESSES answer as typed text, never stored.
test('the text lane is typed and never stored — 21.3', async () => {
    const answer = plainAnswer('not found', 404)
    expect(answer.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(answer.headers.get('cache-control')).toBe('private, no-store')
    expect(await answer.text()).toBe('not found')
})

// 35.3 — A PAGE'S LANE escalates past an error page that fails, and with none left answers the
// refusal as text under the document's headers. THE REVERT: rethrow from the loop's catch; the
// first error page's throw escapes, and the refusal is never answered.
test('the page lane escalates past a failing error page to text — 35.2, 35.3', async () => {
    const broken = {
        pattern: '/',
        segments: parseRoutePattern('/'),
        load: () => Promise.reject(new Error('the error page broke')),
        layouts: [],
        matchers: {},
    }
    const answer = await inReleasedScope(
        new Request('http://app.test/missing'),
        () =>
            answerFailure(
                { errors: [broken], errorDocument: '<!doctype html>' },
                '/missing',
                refuse(404, 'nothing here'),
                new Request('http://app.test/missing'),
            ),
    )
    expect(answer.status).toBe(404)
    expect(answer.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(answer.headers.get('content-security-policy')).toBe(
        "frame-ancestors 'none'",
    )
    expect(await answer.text()).toBe('nothing here')
})
