// SECTION 48 — THE SERVER'S HALF OF A PROBLEM REPORT: the lines it holds for a draft's traces, handed
// to the native app's window alone (48.4, 48.5), the secrets taken out of everything a report holds
// (48.10), and the send, to every `onReport` (48.6).

import { REPORT_ADDRESS, REPORT_LINES_ADDRESS } from '#shared/ADDRESSES.ts'
import { log, type LogRecord, namedLogger } from '#shared/log.ts'
import { refuse } from '#shared/refuse.ts'
import {
    markdownOf,
    type Report,
    REPORT_LINES,
    REPORTING,
} from '#shared/report.ts'
import { declare } from '#shared/rpc.ts'

import { fromNativeWindow } from './bridgeRelay.ts'
import { appIdentity, config } from './config.ts'
import { configFields } from './configFields.ts'
import { HOOKS, inOrder } from './hooks.ts'
import { mountedOwn } from './mountHandlers.ts'
import { principalSecrets } from './principal.ts'
import { currentRequestScope } from './requestScope.ts'

const REPORT_LOG = namedLogger('abide:report')

/** A secret this short is left in place: it would be found inside words that are not it. */
const SHORTEST_SECRET = 4

/** 48.10 — each secret the app holds, by the name it is written under in its place. */
function secrets(): [name: string, value: string][] {
    const resolved = (config.peek() ?? {}) as Record<string, unknown>
    const found: [string, string][] = []
    // 36.5 — a list, rotated in: each of its secrets is one to take out.
    for (const secret of principalSecrets())
        if (secret.length >= SHORTEST_SECRET)
            found.push(['ABIDE_PRINCIPAL_SECRET', secret])
    for (const field of configFields({})) {
        if (field.input !== 'password') continue
        const value = resolved[field.name] ?? process.env[field.name]
        if (typeof value === 'string' && value.length >= SHORTEST_SECRET)
            found.push([field.name, value])
    }
    return found
}

/** `text` with each secret in `held` written as `[redacted <name>]`. */
function redacted(text: string, held: [string, string][]): string {
    let out = text
    for (const [name, value] of held)
        out = out.replaceAll(value, `[redacted ${name}]`)
    return out
}

function redactedLine(line: LogRecord, held: [string, string][]): LogRecord {
    return {
        time: line.time,
        level: line.level,
        namespace: line.namespace,
        message: redacted(line.message, held),
        trace: line.trace,
        span: line.span,
    }
}

/** 48.4 — the server's newest lines whose trace is among `traces`, their secrets taken out. */
function serverLines(traces: readonly string[]): LogRecord[] {
    if (traces.length === 0) return []
    const wanted = new Set(traces)
    const held = secrets()
    const all = log.records()
    const lines: LogRecord[] = []
    for (
        let at = all.length - 1;
        at >= 0 && lines.length < REPORT_LINES;
        at -= 1
    ) {
        const line = all[at] as LogRecord
        if (wanted.has(line.trace)) lines.push(redactedLine(line, held))
    }
    return lines.reverse()
}

/**
 * 48.6, 48.8 — hands `report`, its secrets taken out, to every `onReport`, every one even where one
 * throws, and refuses where none is filed or any threw.
 */
async function deliver(given: Report): Promise<void> {
    const hooks = inOrder(HOOKS.reports)
    if (hooks.length === 0)
        throw refuse(501, 'no onReport is filed, so a report has nowhere to go')
    const held = secrets()
    const lines: LogRecord[] = []
    for (const line of given.lines) lines.push(redactedLine(line, held))
    const summary = redacted(given.summary, held)
    const description = redacted(given.description, held)
    const context = {
        version: given.version,
        platform: given.platform,
        route: given.route,
    }
    const report: Report = {
        summary,
        description,
        ...context,
        traces: given.traces,
        lines,
        markdown: markdownOf(
            summary,
            description,
            context,
            given.traces,
            lines,
        ),
    }
    let failed = false
    for (const send of hooks)
        try {
            await send(report)
        } catch (thrown) {
            failed = true
            REPORT_LOG.error('an onReport threw', thrown)
        }
    if (failed) throw refuse(502, 'the report was not delivered')
}

/** What a draft made on a server holds beside what was written: the app's version, and where. */
function serverContext(): { version: string; platform: string; route: string } {
    const asked = currentRequestScope()?.request
    return {
        version: appIdentity().version,
        platform: asked?.headers.get('user-agent') ?? process.platform,
        route: asked === undefined ? '' : new URL(asked.url).pathname,
    }
}

/** Fills `#shared`'s slot, so a draft made on a server reads and sends in process. */
export function installReporting(): void {
    REPORTING.lines = serverLines
    REPORTING.send = deliver
    REPORTING.context = serverContext
}

const NO_SURFACE = {
    clients: { ui: false, mcp: false, cli: false, openapi: false },
}

// 48.4, 48.5 — THE WINDOW'S, BY ITS CREDENTIAL (44.79): its user agent is a hint any client can
// claim (38.141), and a browser claiming it would read the lines of every request but its own.
const linesHandler = declare('GET')(
    ({ traces }: { traces?: string }): LogRecord[] =>
        fromNativeWindow() && typeof traces === 'string'
            ? serverLines(traces.split(',').filter((trace) => trace !== ''))
            : [],
    NO_SURFACE,
)

function textOf(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

function pageLines(value: unknown): LogRecord[] {
    if (!Array.isArray(value)) return []
    const lines: LogRecord[] = []
    for (const line of value)
        if (line !== null && typeof line === 'object')
            lines.push({
                time: textOf(line.time),
                level: ['debug', 'info', 'warning', 'error'].includes(
                    line.level,
                )
                    ? line.level
                    : 'info',
                namespace: textOf(line.namespace),
                message: textOf(line.message),
                // 48.11 — the page's own lines name no trace, and one that claims one claims nothing.
                trace: '',
                span: undefined,
            })
    return lines.slice(-REPORT_LINES)
}

// 48.6 — A BROWSER'S DRAFT: what it wrote and its own lines, with the server's for its traces added
// back where it is the native app's window, as its draft showed them (48.4).
const sendHandler = declare('POST')(
    async (body: {
        summary?: unknown
        description?: unknown
        route?: unknown
        traces?: unknown
        lines?: unknown
    }): Promise<null> => {
        const traces = Array.isArray(body.traces)
            ? body.traces.filter(
                  (trace): trace is string => typeof trace === 'string',
              )
            : []
        const page = pageLines(body.lines)
        const server = fromNativeWindow() ? serverLines(traces) : []
        const lines = [...page, ...server].sort((first, second) =>
            first.time < second.time ? -1 : first.time > second.time ? 1 : 0,
        )
        const context = serverContext()
        await deliver({
            summary: textOf(body.summary),
            description: textOf(body.description),
            version: context.version,
            platform: context.platform,
            route: textOf(body.route),
            traces,
            lines,
            markdown: '',
        })
        return null
    },
    NO_SURFACE,
)

/** The handlers abide mounts itself for a report: its lines, and its send. */
export const REPORT_MOUNTS = [
    mountedOwn(REPORT_LINES_ADDRESS, 'reportLines', linesHandler),
    mountedOwn(REPORT_ADDRESS, 'report', sendHandler, 'POST'),
] as const
