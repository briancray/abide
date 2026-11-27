// 24.9, 24.10 — A SPAN CARRIES ITS PLACE IN THE TRACE: its own id, the span it ran under, and how it
// went, so the lines of one trace are a tree rather than a list of names and durations.

import { afterEach, expect, test } from 'bun:test'

import { log, refuse, rpc, trace } from '#server'
import type { LogRecord } from '#shared/log.ts'

import { inMemoryApp } from './inMemoryApp.ts'

const CALLER_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'
const CALLER_SPAN = '00f067aa0ba902b7'
const SERVED_TRACE = '0af7651916cd43dd8448eb211c80319c'
const saved = process.env.DEBUG

afterEach(() => {
    if (saved === undefined) delete process.env.DEBUG
    else process.env.DEBUG = saved
})

const spansOf = (traceId: string): LogRecord[] =>
    log.records
        .get()
        .filter(
            (record) => record.trace === traceId && record.span !== undefined,
        )

const respondedSpan = (answer: Response): string =>
    (answer.headers.get('traceresponse') as string).split('-')[2] as string

// THE REVERT: `trace.span` writing `parent: ''` — the inner span names no parent, and the outer
// names none either, so the request's span heads nothing.
test('a span names its own id and the span it opened under, and a throw closes it as an error — 24.9', async () => {
    await using app = await inMemoryApp({
        'probe/nested.server.ts': {
            default: rpc(() =>
                trace.span('outer', () =>
                    trace.span('inner', () => {
                        try {
                            trace.span('broken', () => {
                                throw new Error('broke')
                            })
                        } catch {}
                        return trace()
                    }),
                ),
            ),
        },
    })
    const answer = await app.fetch(
        new Request('http://app.test/probe/nested', {
            headers: { traceparent: `00-${CALLER_TRACE}-${CALLER_SPAN}-01` },
        }),
    )
    expect(await answer.json()).toBe(CALLER_TRACE)
    const byName = new Map(
        spansOf(CALLER_TRACE).map((record) => [record.span?.name, record.span]),
    )
    const outer = byName.get('outer')
    const inner = byName.get('inner')
    const broken = byName.get('broken')
    expect(outer?.parent).toBe(respondedSpan(answer))
    expect(inner?.parent).toBe(outer?.id)
    expect(broken?.parent).toBe(inner?.id)
    expect(new Set([outer?.id, inner?.id, broken?.id]).size).toBe(3)
    expect([outer?.status, inner?.status, broken?.status]).toEqual([
        'ok',
        'ok',
        'error',
    ])
    expect(outer?.kind).toBe('internal')
    expect(outer?.duration).toBeGreaterThanOrEqual(inner?.duration as number)
})

test('a span whose promise rejects closes as an error, and the rejection reaches the caller — 24.9', async () => {
    await using app = await inMemoryApp({
        'probe/rejected.server.ts': {
            default: rpc(async () => {
                await trace
                    .span('rejecting', () => Promise.reject(new Error('no')))
                    .catch(() => {})
                return trace()
            }),
        },
    })
    const answer = await app.fetch(
        new Request('http://app.test/probe/rejected'),
    )
    const id = (await answer.json()) as string
    expect(
        spansOf(id).map((record) => [record.span?.name, record.span?.status]),
    ).toContainEqual(['rejecting', 'error'])
})

// THE REVERT: `writeRequestSpan` naming a fresh id rather than `current.span` — the request's span
// is not the one `traceresponse` names, and the caller cannot find it.
test('a request is a server span under the caller’s, named by its method and route — 24.10', async () => {
    process.env.DEBUG = 'abide:request'
    await using app = await inMemoryApp({
        'probe/fine.server.ts': { default: rpc(() => 'fine') },
        'probe/failing.server.ts': {
            default: rpc(() => {
                throw refuse(503, 'down')
            }),
        },
    })
    const fine = await app.fetch(
        new Request('http://app.test/probe/fine', {
            headers: { traceparent: `00-${SERVED_TRACE}-${CALLER_SPAN}-01` },
        }),
    )
    const failing = await app.fetch(
        new Request('http://app.test/probe/failing'),
    )
    const traceOf = (answer: Response): string =>
        (answer.headers.get('traceresponse') as string).split('-')[1] as string
    const [served] = spansOf(SERVED_TRACE)
    expect(served?.span?.name).toBe('GET /probe/fine')
    expect(served?.namespace).toBe('abide:request')
    expect(served?.level).toBe('debug')
    expect(served?.span).toMatchObject({
        id: respondedSpan(fine),
        parent: CALLER_SPAN,
        kind: 'server',
        status: 'ok',
        attributes: {
            'http.request.method': 'GET',
            'url.path': '/probe/fine',
            'http.response.status_code': 200,
        },
    })
    const [refused] = spansOf(traceOf(failing))
    expect(refused?.span?.parent).toBe('')
    expect(refused?.span?.status).toBe('error')
    expect(refused?.span?.attributes['http.response.status_code']).toBe(503)
})

test('a request writes no span where abide:request is closed — 24.10, 28.7', async () => {
    delete process.env.DEBUG
    await using app = await inMemoryApp({
        'probe/quiet.server.ts': { default: rpc(() => 'q') },
    })
    const answer = await app.fetch(new Request('http://app.test/probe/quiet'))
    expect(
        spansOf(
            (answer.headers.get('traceresponse') as string).split(
                '-',
            )[1] as string,
        ),
    ).toEqual([])
})
