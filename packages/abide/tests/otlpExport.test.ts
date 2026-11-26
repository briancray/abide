// 36.19-36.23 — WHAT THE OTLP EXPORTER SENDS, read off a collector that is a stubbed `fetch`: the
// app's lines as OTLP log records, its spans — the request's own among them — as OTLP spans, under the
// service the standard variables name, and nothing at all where they name no endpoint.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { log, rpc, trace } from '#server'
import { exporting, flushExports, stopExporting } from '#server/otlpExport.ts'

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
let posted: {
    url: string
    headers: Headers
    body: Record<string, unknown>
    signal: AbortSignal | null | undefined
}[] = []
let collectorStatus = 200
// A send the collector holds without answering until this settles; the first post takes it.
let held: Promise<void> | undefined

beforeEach(() => {
    posted = []
    collectorStatus = 200
    held = undefined
    globalThis.fetch = (async (input: string | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.url
        if (!url.startsWith('http://collector.test/'))
            return unstubbedFetch(input, init)
        posted.push({
            url,
            headers: new Headers(init?.headers),
            body: JSON.parse(String(init?.body)),
            signal: init?.signal,
        })
        const holding = held
        held = undefined
        await holding
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
    'probe/traced.server.ts': {
        default: rpc(() =>
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

// THE REVERT: chain a send per batch onto the last (`sending = sending.then(() => send(batch, to))`)
// and every batch waits in the chain rather than the queue — 5,120 lines in the posts after the held
// one, against the 4,096 the bound keeps.
test('lines a collector has not taken yet wait in the queue, 4096 at most, the oldest dropped — 36.23', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector.test'
    let answer = (): void => {}
    held = new Promise<void>((resolve) => {
        answer = resolve
    })
    await using _app = await inMemoryApp(probe)
    const unspied = console.log
    console.log = () => {}
    try {
        for (let at = 0; at < 6000; at += 1) log(`line ${at}`)
    } finally {
        console.log = unspied
    }
    await Bun.sleep(0)
    const heldPosts = posted.length
    answer()
    await flushExports()
    const after: string[] = []
    for (const each of posted.slice(heldPosts))
        for (const resource of each.body.resourceLogs as {
            scopeLogs: { logRecords: { body: { stringValue: string } }[] }[]
        }[])
            for (const scope of resource.scopeLogs)
                for (const record of scope.logRecords)
                    after.push(record.body.stringValue)
    expect(heldPosts).toBe(1)
    expect(after).toHaveLength(4096)
    expect(after.at(-1)).toBe('line 5999')
    expect(after[0]).toBe('line 1904')
})

/** Every log record's text across `posts`, in the order posted. */
function linesIn(posts: typeof posted): string[] {
    const lines: string[] = []
    for (const each of posts)
        for (const resource of (each.body.resourceLogs ?? []) as {
            scopeLogs: { logRecords: { body: { stringValue: string } }[] }[]
        }[])
            for (const scope of resource.scopeLogs)
                for (const record of scope.logRecords)
                    lines.push(record.body.stringValue)
    return lines
}

// 36.23 — A SEND HAS A DEADLINE, so a collector that never answers holds a stop no longer than OTLP's
// default. THE REVERT: drop `signal` from `post`'s fetch -> no signal goes with the send.
test('a send goes out with a deadline it is abandoned at — 36.23', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector.test'
    await using _app = await inMemoryApp(probe)
    log('one line')
    await flushExports()
    expect(posted.at(-1)?.signal instanceof AbortSignal).toBe(true)
    expect(posted.at(-1)?.signal?.aborted).toBe(false)
})

// 36.23 — A STOP LEAVES NOTHING QUEUED: a line written while its last send is out is not left for the
// next app this process boots, to be sent under that app's name. THE REVERT: drop `queued = []` from
// `stopExporting` -> the next app's collector is sent 'during the last send'.
test("a line written during a stop's last send is not sent by the next app — 36.23", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector.test'
    const release: (() => void)[] = []
    const hold = (): void => {
        held = new Promise<void>((resolve) => release.push(resolve))
    }
    const first = await inMemoryApp(probe)
    const unspied = console.log
    console.log = () => {}
    try {
        log('a send out before the stop')
        hold()
        void flushExports()
        await Bun.sleep(0)
        const stopping = stopExporting()
        log("the stop's last send")
        hold()
        ;(release.shift() as () => void)()
        await Bun.sleep(0)
        log('during the last send')
        ;(release.shift() as () => void)()
        await stopping
    } finally {
        console.log = unspied
    }
    await first[Symbol.asyncDispose]()
    const before = posted.length
    await using _next = await inMemoryApp(probe)
    await flushExports()
    expect(linesIn(posted.slice(0, before))).toContain("the stop's last send")
    expect(linesIn(posted.slice(before))).not.toContain('during the last send')
})
