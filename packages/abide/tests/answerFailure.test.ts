import { expect, test } from 'bun:test'
import { answered, answerFailure } from '#server/answerFailure.ts'
import { plainAnswer } from '#server/plainAnswer.ts'
import { inReleasedScope } from '#server/requestScope.ts'
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
            ),
    )
    expect(answer.status).toBe(404)
    expect(answer.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(answer.headers.get('content-security-policy')).toBe(
        "frame-ancestors 'none'",
    )
    expect(await answer.text()).toBe('nothing here')
})
