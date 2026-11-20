// SECTION 48 — A PROBLEM REPORT: what a person was doing, in their words, and the log lines behind
// it, drafted where they can read every word of it and sent only when they say so.
//
// ONE DRAFT, BOTH SIDES. In a browser it holds the page's own lines, the server's for its traces
// where the page is the native app's window (48.4), and is sent to `/__abide/report`; on a server
// it holds the server's lines and is handed to `onReport` in process, through `REPORTING`, which the
// server fills — a slot rather than an import, so the server's hooks stay out of a browser bundle.

import { REPORT_ADDRESS, REPORT_LINES_ADDRESS } from './ADDRESSES.ts'
import { answered, answerOf } from './answerOf.ts'
import { isFailed } from './Failed.ts'
import { log, type LogRecord, tsvLine } from './log.ts'
import { mounted } from './mount.ts'
import { randomToken } from './randomToken.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { rpcRequest } from './rpcRequest.ts'
import { seededDocument } from './seededDocument.ts'

/** What a draft's lines are cut to, newest kept: the page's, and the server's (48.2, 48.3). */
export const REPORT_LINES = 200

/** A report as it is sent, and as `onReport` is handed it. */
export type Report = {
    /** 48.12 — the draft's, the same on every send of it. */
    id: string
    summary: string
    description: string
    version: string
    platform: string
    route: string
    traces: string[]
    lines: LogRecord[]
    markdown: string
}

/** What the server does with a draft in process: its lines for `traces`, and the send. */
export const REPORTING: {
    lines: ((traces: readonly string[]) => LogRecord[]) | undefined
    send: ((report: Report) => Promise<void>) | undefined
    context:
        (() => { version: string; platform: string; route: string }) | undefined
} = { lines: undefined, send: undefined, context: undefined }

/** A report not yet sent: what the person writes, and what goes with it. */
export class ReportDraft {
    /** 48.12 — minted with the draft, and what every send of it hands back. */
    readonly id: string = randomToken(16, 'hex')
    readonly summary: Reactive<string> = reactive('')
    readonly description: Reactive<string> = reactive('')
    readonly traces: string[]
    readonly lines: Reactive<LogRecord[]>
    /** 48.7 — the whole of what `send` sends, as text. */
    readonly markdown: Reactive<string>
    #context: { version: string; platform: string; route: string }
    /** 48.13 — the send in flight or done, so a second one delivers nothing more. */
    #sent: Promise<string> | undefined = undefined

    constructor(traces: string[]) {
        this.traces = traces
        this.#context = REPORTING.context?.() ?? browserContext()
        this.lines = reactive(linesFor(traces))
        this.markdown = reactive(() =>
            markdownOf(
                this.summary(),
                this.description(),
                this.#context,
                this.traces,
                // Empty while the server's lines are on their way (48.4).
                this.lines() ?? [],
            ),
        )
    }

    /**
     * 48.9 — shows the draft in abide's own dialog over the page, in a browser; settles `true` once
     * it is sent, and `false` where it is closed unsent.
     */
    open(): Promise<boolean> {
        if (typeof document === 'undefined')
            throw new Error(
                'abide: a ReportDraft opens only in a browser; on a server, send it. RULEBOOK 48.9.',
            )
        return import('#ui/reportDialog.ts').then(({ reportDialog }) =>
            reportDialog(this),
        )
    }

    /**
     * 48.8, 48.13 — hands the report to every `onReport` and settles its `id`; refuses, leaving the
     * draft as it was, where one throws. Sent once, it settles the same `id` without sending again.
     */
    send(): Promise<string> {
        if (this.#sent !== undefined) return this.#sent
        const sending = this.#deliver().then(
            () => this.id,
            (thrown: unknown) => {
                this.#sent = undefined
                throw thrown
            },
        )
        this.#sent = sending
        return sending
    }

    async #deliver(): Promise<void> {
        const summary = this.summary()
        const description = this.description()
        const lines = await this.lines
        const report: Report = {
            id: this.id,
            summary,
            description,
            ...this.#context,
            traces: this.traces,
            lines,
            markdown: markdownOf(
                summary,
                description,
                this.#context,
                this.traces,
                lines,
            ),
        }
        if (REPORTING.send !== undefined) return REPORTING.send(report)
        const request = rpcRequest('POST', mounted(REPORT_ADDRESS), {
            id: this.id,
            summary,
            description,
            route: report.route,
            traces: report.traces,
            lines: pageLinesOf(lines),
        })
        const answer = await answerOf(request, false, undefined)
        const value = answered(answer, request)
        if (isFailed(value)) throw value
    }
}

/** 48.1 — a draft of a problem, holding `trace` among its traces where given one. */
export function report(options?: { trace?: string }): ReportDraft {
    return new ReportDraft(
        options?.trace === undefined || options.trace === ''
            ? []
            : [options.trace],
    )
}

function browserContext(): {
    version: string
    platform: string
    route: string
} {
    return {
        version: '',
        platform: typeof navigator === 'undefined' ? '' : navigator.userAgent,
        route: typeof location === 'undefined' ? '' : location.pathname,
    }
}

/**
 * The lines a draft holds: the server's for `traces` on a server; in a browser, the page's own, and
 * the server's for `traces` where the server hands them (48.4), each cut to the newest `REPORT_LINES`.
 */
function linesFor(traces: string[]): LogRecord[] | Promise<LogRecord[]> {
    if (REPORTING.lines !== undefined) return REPORTING.lines(traces)
    const page = log.records().slice(-REPORT_LINES)
    if (traces.length === 0) return page
    return Promise.resolve(
        seededDocument<LogRecord[]>(REPORT_LINES_ADDRESS, {
            traces: traces.join(','),
        }),
    ).then((server) =>
        Array.isArray(server) ? mergedByTime(page, server) : page,
    )
}

/** The page's lines and the server's, in the order they were written. */
function mergedByTime(page: LogRecord[], server: LogRecord[]): LogRecord[] {
    const merged = [...page, ...server]
    merged.sort((first, second) =>
        first.time < second.time ? -1 : first.time > second.time ? 1 : 0,
    )
    return merged
}

/** The lines a browser sends: its own, which the server cannot read; the server adds its own back. */
function pageLinesOf(lines: LogRecord[]): LogRecord[] {
    const own: LogRecord[] = []
    for (const line of lines) if (line.trace === '') own.push(line)
    return own
}

/** A report's text: what was written, where, and the lines, one per row as a log file has them. */
export function markdownOf(
    summary: string,
    description: string,
    context: { version: string; platform: string; route: string },
    traces: readonly string[],
    lines: readonly LogRecord[],
): string {
    let text = `## ${summary === '' ? 'Problem report' : summary}\n\n`
    if (description !== '') text += `${description}\n\n`
    if (context.version !== '') text += `- version: ${context.version}\n`
    if (context.platform !== '') text += `- platform: ${context.platform}\n`
    if (context.route !== '') text += `- route: ${context.route}\n`
    if (traces.length !== 0) text += `- traces: ${traces.join(', ')}\n`
    if (lines.length === 0) return text
    text += '\n```\n'
    for (const line of lines) text += `${tsvLine(line)}\n`
    return `${text}\`\`\`\n`
}
