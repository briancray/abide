// SECTION 28 — the logger, on both sides. A line is written to the console AND published to
// `log.records` (28.1), so a subscriber — `abide logs`, a test, a page — sees exactly what the
// terminal saw.
//
// THE RECORDS ARE BUILT ON FIRST ASK. The reactive core warns through this module, so a
// `reactive` built at this module's evaluation would be a cycle evaluated in the wrong order;
// built on the first line or the first read of `log.records`, the core has long since loaded.
//
// 28.10, 28.11 — IN A BROWSER, `DEBUG` IS THE DOCUMENT'S: the server names it in a `<meta>` it writes
// into the head, and the browser's own stored `debug` answers only where the document carries none.

import { DEBUG_META } from './DEBUG_META.ts'
import { type Reactive, reactive } from './reactive/index.ts'

type Level = 'debug' | 'info' | 'warning' | 'error'

export type LogRecord = {
    time: string
    level: Level
    namespace: string
    message: string
    trace: string
}

export type Logger = ((...args: unknown[]) => void) & {
    info(...args: unknown[]): void
    warning(...args: unknown[]): void
    error(...args: unknown[]): void
    debug(...args: unknown[]): void
    named(name: string): Logger
    enabled(): boolean
    readonly records: Reactive<LogRecord>
}

/**
 * The slot a line's trace id is read through, filled by the server.
 *
 * Where a line's trace id comes from once section 24 fills it in — a slot rather than an import, so
 * the isomorphic logger does not drag the server's request scope into a browser bundle.
 */
export const TRACE: { current: () => string } = { current: () => '' }

const DEFAULT_HISTORY = 1000

let records: Reactive<LogRecord> | undefined

function recordsValue(): Reactive<LogRecord> {
    if (records === undefined) {
        const configured = Number(environment('ABIDE_MAX_LOG_BUFFER_COUNT'))
        records = reactive<LogRecord>(undefined, {
            history:
                Number.isInteger(configured) && configured >= 0
                    ? configured
                    : DEFAULT_HISTORY,
        })
    }
    return records
}

/**
 * The document's `DEBUG`, read once per document.
 *
 * READ ONCE PER DOCUMENT, as `MOUNT` is: every gated line asks, and a document with no `DEBUG` has no
 * `<meta>` for the selector to find, so each ask walked the whole document and then storage. The
 * server writes the tag ahead of the script, and a stored setting changed after load answers on the
 * next load, as debug-npm's does.
 */
let documentDebugRead: string | undefined

function environment(name: string): string | undefined {
    if (typeof process !== 'undefined') return process.env[name]
    if (name !== 'DEBUG') return undefined
    documentDebugRead ??= documentDebug() ?? ''
    return documentDebugRead
}

/** The document's `DEBUG`, or the browser's own stored one where it carries none (28.10, 28.11). */
export function documentDebug(): string | undefined {
    if (typeof document === 'undefined') return undefined
    const named = document
        .querySelector(`meta[name="${DEBUG_META}"]`)
        ?.getAttribute('content')
    if (named !== null && named !== undefined) return named
    // A sandboxed frame refuses storage outright, and that is no setting at all.
    try {
        return localStorage.getItem('debug') ?? undefined
    } catch {
        return undefined
    }
}

/**
 * The compiled `DEBUG` patterns: namespaces included, and namespaces excluded.
 *
 * 28.9 — THE debug-npm GRAMMAR: a list split on commas or whitespace, `*` any run of characters,
 * and a leading `-` an exclusion that beats every inclusion. Compiled once per distinct `DEBUG`.
 */
type Gate = { include: RegExp[]; exclude: RegExp[] }
let gateFor: string | undefined
let gate: Gate = { include: [], exclude: [] }

function currentGate(): Gate {
    const debug = environment('DEBUG') ?? ''
    if (debug === gateFor) return gate
    gateFor = debug
    const include: RegExp[] = []
    const exclude: RegExp[] = []
    for (const part of debug.split(/[\s,]+/)) {
        if (part === '') continue
        const negated = part.startsWith('-')
        const body = (negated ? part.slice(1) : part)
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replaceAll('*', '.*')
        ;(negated ? exclude : include).push(new RegExp(`^${body}$`))
    }
    gate = { include, exclude }
    return gate
}

/** Whether `DEBUG` enables a namespace's gated lines (28.6). */
function isEnabled(namespace: string): boolean {
    const { include, exclude } = currentGate()
    for (const pattern of exclude) if (pattern.test(namespace)) return false
    for (const pattern of include) if (pattern.test(namespace)) return true
    return false
}

/**
 * The format a line is written in: `tsv`, `json` or `readable`.
 *
 * 36.8 and 36.9 — read per line rather than at load: a test or a host setting the environment
 * after import is still answered.
 */
function formatOf(): 'tsv' | 'json' | 'readable' {
    const format = environment('ABIDE_LOG_FORMAT')
    if (format === 'tsv' || format === 'json') return format
    if (typeof process === 'undefined') return 'readable'
    return process.stdout.isTTY === true ? 'readable' : 'tsv'
}

function useColor(): boolean {
    if (typeof process === 'undefined') return false
    if (environment('NO_COLOR') !== undefined) return false
    if (environment('FORCE_COLOR') !== undefined) return true
    return process.stdout.isTTY === true
}

const LEVEL_COLOR: Record<Level, string> = {
    debug: '\x1b[90m',
    info: '\x1b[36m',
    warning: '\x1b[33m',
    error: '\x1b[31m',
}

function messageOf(args: unknown[]): string {
    let message = ''
    for (let at = 0; at < args.length; at += 1) {
        const arg = args[at]
        if (at > 0) message += ' '
        if (typeof arg === 'string') message += arg
        else if (typeof globalThis.Bun?.inspect === 'function')
            message += Bun.inspect(arg)
        else if (arg instanceof Error) message += arg.stack ?? arg.message
        else
            try {
                message += JSON.stringify(arg)
            } catch {
                message += String(arg)
            }
    }
    return message
}

function write(
    namespace: string,
    level: Level,
    args: unknown[],
    time = new Date().toISOString(),
): void {
    const record: LogRecord = {
        time,
        level,
        namespace,
        message: messageOf(args),
        trace: TRACE.current(),
    }
    const format = formatOf()
    let line: string
    if (format === 'json') line = JSON.stringify(record)
    else if (format === 'tsv')
        line = `${record.time}\t${level}\t${namespace}\t${record.trace}\t${record.message.replaceAll('\n', '\\n')}`
    else if (useColor())
        line = `\x1b[90m${record.time}\x1b[0m ${LEVEL_COLOR[level]}${level}\x1b[0m \x1b[1m${namespace}\x1b[0m ${record.message}`
    else line = `${record.time} ${level} ${namespace} ${record.message}`
    if (level === 'error') console.error(line)
    else if (level === 'warning') console.warn(line)
    else console.log(line)
    recordsValue().publish(record)
}

/** A logger under `namespace`, which 28.4 builds from the app's name and 28.8 from `abide:`. */
export function namedLogger(namespace: string): Logger {
    return loggerOver(() => namespace)
}

/**
 * A logger whose namespace is asked per line.
 *
 * The namespace is ASKED per line rather than held, which is all `log` needs over a named logger.
 */
function loggerOver(namespaceOf: () => string): Logger {
    // 28.2 — the bare call always writes. 28.3 — so do warnings and errors.
    const logger = ((...args: unknown[]): void => {
        write(namespaceOf(), 'info', args)
    }) as Logger
    logger.info = (...args) => {
        const namespace = namespaceOf()
        if (isEnabled(namespace)) write(namespace, 'info', args)
    }
    logger.debug = (...args) => {
        const namespace = namespaceOf()
        if (isEnabled(namespace)) write(namespace, 'debug', args)
    }
    logger.warning = (...args) => write(namespaceOf(), 'warning', args)
    logger.error = (...args) => write(namespaceOf(), 'error', args)
    // 28.4 — another segment, below this one.
    logger.named = (name) => namedLogger(`${namespaceOf()}:${name}`)
    logger.enabled = () => isEnabled(namespaceOf())
    Object.defineProperty(logger, 'records', { get: recordsValue })
    return logger
}

/**
 * The slot the derived app name is read through, filled by the server's `config`.
 *
 * 28.4 — the app's name is the root every `log.named` hangs off: the environment's, or what 27.3
 * derived, which the server's `config` fills in here.
 */
export const APP_NAME: { derived: () => string | undefined } = {
    derived: () => undefined,
}

function appName(): string {
    return environment('APP_NAME') ?? APP_NAME.derived() ?? 'app'
}

/**
 * Writes a span as an `info` line under the app's namespace, stamped with its start.
 *
 * 24.3, 24.4 — A SPAN IS A LINE under the app's own namespace, stamped with when it STARTED. Written
 * whatever `DEBUG` says: an app that opened one asked for it.
 */
export function writeSpan(startedAt: string, message: string): void {
    write(appName(), 'info', [message], startedAt)
}

/**
 * The app's logger, under the app's name.
 *
 * THE DEFAULT NAMESPACE IS READ PER LINE, like the format: `APP_NAME` set by a host after this
 * module loaded still names the line.
 */
export const log: Logger = loggerOver(appName)
