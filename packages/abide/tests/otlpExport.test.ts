// 36.19-36.23 — WHAT THE OTLP EXPORTER SENDS, read off a collector that is a stubbed `fetch`: the
// app's lines as OTLP log records, its spans — the request's own among them — as OTLP spans, under the
// service the standard variables name, and nothing at all where they name no endpoint.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { GET, log, trace } from '#server'
import { exporting, flushExports } from '#server/otlpExport.ts'

import { inMemoryApp } from './inMemoryApp.ts'

const CALLER_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'
const CALLER_SPAN = '00f067aa0ba902b7'
const VARIABLES = [
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'OTEL_EXPORTER_OTLP_HEADERS',
    'OTEL_SERVICE_NAME',
    'DEBUG',
] as const
const saved = Object.fromEntries(
    VARIABLES.map((name) => [name, process.env[name]]),
)
const unstubbedFetch = globalThis.fetch
let posted: { url: string; headers: Headers; body: Record<string, unknown> }[] =
    []
let collectorStatus = 200

beforeEach(() => {
    posted = []
    collectorStatus = 200
    globalThis.fetch = (async (input: string | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.url
        if (!url.startsWith('http://collector.test/'))
            return unstubbedFetch(input, init)
        posted.push({
            url,
            headers: new Headers(init?.headers),
            body: JSON.parse(String(init?.body)),
        })
        return new Response(null, { status: collectorStatus })
    }) as typeof fetch
})

afterEach(() => {
    globalThis.fetch = unstubbedFetch
    for (const name of VARIABLES)
        if (saved[name] === undefined) delete process.env[name]
        else process.env[name] = saved[name]
})

type Attribute = { key: string; value: Record<string, unknown> }
type OtlpSpan = {
    traceId: string
    spanId: string
    parentSpanId?: string
    name: string
    kind: number
    attributes: Attribute[]
    status: { code: number }
}

const probe = {
    'probe/traced.handler.ts': {
        default: GET(() =>
            trace.span('lookup', () => {
                log('looked up the contact')
                return trace()
            }),
        ),
    },
}

// THE REVERT: drop `startExporting()` from `bootEntered` — nothing is posted, and every list is empty.
test('lines and spans reach the collector as OTLP, the request as the root span — 36.19-36.22, 24.10', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector.test/'
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'x-honeycomb-team=abc%3D'
    process.env.OTEL_SERVICE_NAME = 'ledger'
    delete process.env.DEBUG
    await using app = await inMemoryApp(probe)
    expect(exporting()).toBe(true)
    const answer = await app.fetch(
        new Request('http://app.test/probe/traced', {
            headers: { traceparent: `00-${CALLER_TRACE}-${CALLER_SPAN}-01` },
        }),
    )
    const responded = (answer.headers.get('traceresponse') as string).split(
        '-',
    )[2]
    await flushExports()
    const logs = posted.find(
        (post) => post.url === 'http://collector.test/v1/logs',
    )
    const traces = posted.find(
        (post) => post.url === 'http://collector.test/v1/traces',
    )
    expect(logs?.headers.get('x-honeycomb-team')).toBe('abc=')
    const [resourceLogs] = logs?.body.resourceLogs as {
        resource: { attributes: Attribute[] }
        scopeLogs: {
            scope: { name: string }
            logRecords: Record<string, unknown>[]
        }[]
    }[]
    expect(resourceLogs?.resource.attributes).toContainEqual({
        key: 'service.name',
        value: { stringValue: 'ledger' },
    })
    const records =
        resourceLogs?.scopeLogs.flatMap((scope) => scope.logRecords) ?? []
    expect(records).toContainEqual(
        expect.objectContaining({
            body: { stringValue: 'looked up the contact' },
            traceId: CALLER_TRACE,
            severityNumber: 9,
            severityText: 'INFO',
        }),
    )
    const spans =
        (
            traces?.body.resourceSpans as {
                scopeSpans: { spans: OtlpSpan[] }[]
            }[]
        )[0]?.scopeSpans.flatMap((scope) => scope.spans) ?? []
    const served = spans.find((span) => span.kind === 2)
    const lookup = spans.find((span) => span.name === 'lookup')
    expect(served).toMatchObject({
        traceId: CALLER_TRACE,
        spanId: responded,
        parentSpanId: CALLER_SPAN,
        name: 'GET /probe/traced',
        status: { code: 0 },
    })
    expect(served?.attributes).toContainEqual({
        key: 'http.response.status_code',
        value: { intValue: '200' },
    })
    expect(lookup).toMatchObject({ kind: 1, parentSpanId: responded })
    // Exported, and with `abide:request` closed, written nowhere: no span is a log line as well.
    expect(
        log
            .records()
            .some(
                (record) =>
                    record.namespace === 'abide:request' &&
                    record.trace === CALLER_TRACE,
            ),
    ).toBe(false)
    expect(
        records.some((record) =>
            (record.body as { stringValue: string }).stringValue.startsWith(
                'lookup ',
            ),
        ),
    ).toBe(false)
})

// THE REVERT: read the endpoint unconditionally in `destinationOf` — the app boots exporting.
test('with no endpoint named nothing is exported, and OTEL_SDK_DISABLED turns one named off — 36.19, 36.20', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    await using app = await inMemoryApp(probe)
    expect(exporting()).toBe(false)
    await app.fetch(new Request('http://app.test/probe/traced'))
    await flushExports()
    expect(posted).toEqual([])
    await app.stop()
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector.test'
    process.env.OTEL_SDK_DISABLED = 'true'
    try {
        await using disabled = await inMemoryApp(probe)
        expect(exporting()).toBe(false)
        await disabled.fetch(new Request('http://app.test/probe/traced'))
        await flushExports()
        expect(posted).toEqual([])
    } finally {
        delete process.env.OTEL_SDK_DISABLED
    }
})

// THE REVERT: drop the `failing` check in `post` — the error is said once per batch, three times.
test('a collector that refuses is said once per outage, on stderr — 36.23', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector.test'
    collectorStatus = 503
    const said: string[] = []
    const unspied = console.error
    console.error = (...args: unknown[]) => void said.push(args.join(' '))
    try {
        await using app = await inMemoryApp(probe)
        for (let batch = 0; batch < 3; batch += 1) {
            await app.fetch(new Request('http://app.test/probe/traced'))
            await flushExports()
        }
    } finally {
        console.error = unspied
    }
    const failures = said.filter((line) =>
        line.startsWith('abide: OTLP export failed'),
    )
    expect(failures).toHaveLength(1)
    expect(posted.length).toBeGreaterThan(1)
})
