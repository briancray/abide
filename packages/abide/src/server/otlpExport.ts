// 36.19-36.23 — OPENTELEMETRY, OVER ITS STANDARD VARIABLES AND NOTHING ELSE: with
// `OTEL_EXPORTER_OTLP_ENDPOINT` set, every line the app writes is sent as an OTLP log record and every
// span as an OTLP span, as OTLP/HTTP JSON over `fetch` — Honeycomb, Grafana, Datadog, Jaeger and a
// collector all take it. Unset, nothing is sent and nothing is paid.
//
// FED FROM THE ONE FEED: `log.ts` hands each line to `EXPORT.record` as it writes it (24.3), so there
// is no second place a span or a line is made.
//
// BATCHED, BOUNDED, NEVER WAITED ON: a line is queued and sent with the rest each second, or as soon as
// a batch fills; past the queue's bound the oldest go. A failed send is said once per outage, on
// stderr and not through `log` — a line about the exporter fed back into it would be exported in turn.

import { EXPORT, type LogRecord, type Span } from '#shared/log.ts'
import { messageOf } from '#shared/messageOf.ts'

import { appIdentity } from './config.ts'
import { withoutTrailingSlash } from './withoutTrailingSlash.ts'

const FLUSH_MILLISECONDS = 1000
const BATCH = 512
const QUEUED_AT_MOST = 4096

// 36.21 — OTLP's severity numbers, the first of each band.
const SEVERITY: Record<LogRecord['level'], [number, string]> = {
    debug: [5, 'DEBUG'],
    info: [9, 'INFO'],
    warning: [13, 'WARN'],
    error: [17, 'ERROR'],
}

type Destination = {
    logs: string
    traces: string
    headers: Record<string, string>
}

let destination: Destination | undefined
let queued: LogRecord[] = []
let timer: ReturnType<typeof setInterval> | undefined
let sending: Promise<void> = Promise.resolve()
let failing = false

/** Whether lines and spans are being exported: `OTEL_EXPORTER_OTLP_ENDPOINT` or a signal's own is set. */
export function exporting(): boolean {
    return destination !== undefined
}

/** 36.19, 36.20 — where the standard variables say to send, or `undefined` where they say nowhere. */
function destinationOf(
    env: Record<string, string | undefined>,
): Destination | undefined {
    if (env.OTEL_SDK_DISABLED?.toLowerCase() === 'true') return undefined
    const base = withoutTrailingSlash(env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '')
    const logs =
        env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
        (base === '' ? undefined : `${base}/v1/logs`)
    const traces =
        env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
        (base === '' ? undefined : `${base}/v1/traces`)
    if (logs === undefined && traces === undefined) return undefined
    const headers: Record<string, string> = {
        'content-type': 'application/json',
    }
    for (const pair of (env.OTEL_EXPORTER_OTLP_HEADERS ?? '').split(',')) {
        const at = pair.indexOf('=')
        if (at > 0)
            headers[decodeURIComponent(pair.slice(0, at).trim())] =
                decodeURIComponent(pair.slice(at + 1).trim())
    }
    return { logs: logs ?? '', traces: traces ?? '', headers }
}

/** Begins exporting where the environment names an endpoint; a second call changes nothing. */
export function startExporting(): void {
    if (destination !== undefined) return
    destination = destinationOf(process.env)
    if (destination === undefined) return
    EXPORT.record = (record) => {
        queued.push(record)
        if (queued.length > QUEUED_AT_MOST)
            queued.splice(0, queued.length - QUEUED_AT_MOST)
        if (queued.length >= BATCH) void flushExports()
    }
    timer = setInterval(() => void flushExports(), FLUSH_MILLISECONDS)
    timer.unref()
}

/** Sends everything queued, after whatever send is under way; settles once it is sent or refused. */
export function flushExports(): Promise<void> {
    if (destination === undefined || queued.length === 0) return sending
    const batch = queued
    queued = []
    const to = destination
    sending = sending.then(() => send(batch, to))
    return sending
}

/** Stops exporting, once what is queued is sent. 42.10 — the app's stop waits on it. */
export async function stopExporting(): Promise<void> {
    await flushExports()
    clearInterval(timer)
    timer = undefined
    EXPORT.record = undefined
    destination = undefined
    failing = false
}

async function send(batch: LogRecord[], to: Destination): Promise<void> {
    const lines: LogRecord[] = []
    const spans: LogRecord[] = []
    for (const record of batch)
        (record.span === undefined ? lines : spans).push(record)
    const resource = resourceOf()
    const posts: Promise<void>[] = []
    if (lines.length !== 0 && to.logs !== '')
        posts.push(
            post(to.logs, to.headers, {
                resourceLogs: [
                    {
                        resource,
                        scopeLogs: scopesOf(lines, logRecordOf, 'logRecords'),
                    },
                ],
            }),
        )
    if (spans.length !== 0 && to.traces !== '')
        posts.push(
            post(to.traces, to.headers, {
                resourceSpans: [
                    { resource, scopeSpans: scopesOf(spans, spanOf, 'spans') },
                ],
            }),
        )
    await Promise.all(posts)
}

async function post(
    url: string,
    headers: Record<string, string>,
    body: unknown,
): Promise<void> {
    try {
        const answer = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        })
        if (!answer.ok) throw new Error(`${url} answered ${answer.status}`)
        failing = false
    } catch (thrown) {
        // 36.23 — once per outage, and never through `log`.
        if (!failing)
            console.error(`abide: OTLP export failed: ${messageOf(thrown)}`)
        failing = true
    }
}

/** 36.22 — the app, as every OTLP backend names a service: `OTEL_SERVICE_NAME`, else `APP_NAME`. */
function resourceOf(): { attributes: Attribute[] } {
    const identity = appIdentity()
    return {
        attributes: [
            attribute(
                'service.name',
                process.env.OTEL_SERVICE_NAME ?? identity.name,
            ),
            attribute('service.version', identity.version),
        ],
    }
}

type Attribute = {
    key: string
    value:
        { stringValue: string } | { intValue: string } | { doubleValue: number }
}

function attribute(key: string, value: string | number): Attribute {
    if (typeof value === 'string') return { key, value: { stringValue: value } }
    return Number.isInteger(value)
        ? { key, value: { intValue: String(value) } }
        : { key, value: { doubleValue: value } }
}

/** `records` grouped into one scope per namespace, each in the order written. */
function scopesOf<Item, Key extends 'logRecords' | 'spans'>(
    records: LogRecord[],
    shape: (record: LogRecord) => Item,
    key: Key,
): ({ scope: { name: string } } & Record<Key, Item[]>)[] {
    const byNamespace = new Map<string, Item[]>()
    for (const record of records) {
        let items = byNamespace.get(record.namespace)
        if (items === undefined) {
            items = []
            byNamespace.set(record.namespace, items)
        }
        items.push(shape(record))
    }
    const scopes: ({ scope: { name: string } } & Record<Key, Item[]>)[] = []
    for (const [name, items] of byNamespace)
        scopes.push({ scope: { name }, [key]: items } as {
            scope: { name: string }
        } & Record<Key, Item[]>)
    return scopes
}

/** Milliseconds since the epoch as OTLP's nanoseconds, a decimal string. */
function nanoseconds(milliseconds: number): string {
    return (BigInt(Math.round(milliseconds * 1000)) * 1000n).toString()
}

function logRecordOf(record: LogRecord) {
    const [severityNumber, severityText] = SEVERITY[record.level]
    const time = nanoseconds(Date.parse(record.time))
    return {
        timeUnixNano: time,
        observedTimeUnixNano: time,
        severityNumber,
        severityText,
        body: { stringValue: record.message },
        // OTLP/JSON writes ids as hex, as `traceparent` does.
        ...(record.trace === '' ? {} : { traceId: record.trace }),
    }
}

// 36.21 — OTLP's span kinds and status codes; a span that went well is left unset, as OTel asks.
const KIND: Record<Span['kind'], number> = { internal: 1, server: 2 }

function spanOf(record: LogRecord) {
    const span = record.span as Span
    const started = Date.parse(record.time)
    const attributes: Attribute[] = []
    for (const [key, value] of Object.entries(span.attributes))
        attributes.push(attribute(key, value))
    return {
        traceId: record.trace,
        spanId: span.id,
        ...(span.parent === '' ? {} : { parentSpanId: span.parent }),
        name: span.name,
        kind: KIND[span.kind],
        startTimeUnixNano: nanoseconds(started),
        endTimeUnixNano: nanoseconds(started + span.duration),
        attributes,
        status: { code: span.status === 'error' ? 2 : 0 },
    }
}
