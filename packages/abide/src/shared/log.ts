// The one place anything writes to a console.
//
// Isomorphic like the rest of this surface: the same `log('…')` on both sides, with the two lanes
// differing only in where the gate is read from and what a line is allowed to look like. The gating
// rules and the line shapes are spec'd in docs/SPEC.md; what is here is why the code is shaped the
// way it is. The one rule worth restating at the code: `warning` and `error` are never gated, on any
// channel, because the gate exists to control volume rather than to hide breakage.

import { colorAllowed, stdoutIsTTY } from './internal/env.ts'
import { textKnob } from './internal/knobs.ts'
import { traceId } from './internal/trace.ts'

// --- the app's own name ------------------------------------------------------

// `ABIDE_APP_NAME`, then package.json's `name`, then `abide`. The middle one needs a filesystem, so
// it arrives through a source `abide/server` installs at import — eagerly, unlike the scope and href
// sources, because a line can be written long before anything calls `serve()`. That keeps `$shared`
// free of a node import a browser would only ever bundle as an empty object.
let appNameSource: (() => string | null) | null = null
let resolvedAppName: string | null = null

/** Installed by `abide/server`. Called at most once, and only if `ABIDE_APP_NAME` is unset. */
export function useAppNameSource(source: () => string | null): void {
    appNameSource = source
    resolvedAppName = null
}

/**
 * What this app is called.
 *
 * The log channel's root, and the one `abide/server` names a data directory after — asked here by
 * both, so the two cannot name different things and the filesystem climb behind the source is
 * cached once rather than once per reader.
 *
 * `ABIDE_APP_NAME` through the DOCUMENT, the same seam the gate and the line shape ask across, so an
 * `onConfig` that defaults the variable moves what this resolves. Read off the environment it was a
 * field `config()` published and nothing honoured, which is the one disagreement an operator has no
 * way to catch. What stays a conclusion is this FUNCTION: the accessor is not a field, and the climb
 * under it is not a knob.
 */
export function appName(): string {
    const declared = textKnob('ABIDE_APP_NAME')
    if (declared !== null) return declared
    if (resolvedAppName === null) resolvedAppName = appNameSource?.() ?? 'abide'
    return resolvedAppName
}

// --- the DEBUG gate ----------------------------------------------------------

interface Gate {
    includes: RegExp[]
    excludes: RegExp[]
}

let gateSpec: string | undefined
let gate: Gate = { includes: [], excludes: [] }

// Reading `localStorage.debug` costs ~225 ns against ~15 ns for a property on an ordinary object,
// measured in Safari — which is the WHOLE of what a suppressed channel costs in a browser, since
// everything else on that path is a compare. So the read is held for the rest of the synchronous run
// and dropped on the next microtask: a channel called in a loop pays for one read rather than one per
// call, and a change typed into a console or made by a click is a later turn and is seen on it.
//
// Reading once at module load — what debug-npm does — would be faster still, and would mean reloading
// the page to change anything. A turn is the smallest boundary that keeps the gate live.
let storageSpec: string | undefined
let storageFresh = false
// Asked at load rather than discovered by a throw: a server has no `localStorage` at all, and this is
// what keeps it out of the held-read path entirely — no `globalThis` probe and no microtask per turn.
let localStorageUsable = typeof (globalThis as { localStorage?: unknown }).localStorage !== 'undefined'

function dropStorageSpec(): void {
    storageFresh = false
}

function fromStorage(): string | undefined {
    if (storageFresh) return storageSpec
    if (!localStorageUsable) return undefined
    storageFresh = true
    queueMicrotask(dropStorageSpec)
    try {
        const held = globalThis.localStorage?.debug
        storageSpec = held === undefined || held === '' ? undefined : held
    } catch {
        // Storage can be disabled outright. Ask once.
        localStorageUsable = false
        storageSpec = undefined
    }
    return storageSpec
}

/**
 * The gate's spelling, in debug-npm grammar: `abide:*`, `docs:cards,docs:db`, `*`, `*,-abide:*`.
 *
 * The environment is asked FIRST and `localStorage` second, because in the one place both exist — a
 * DOM emulator under `bun test` — an explicit env var is the more deliberate of the two. A server has
 * no `localStorage` and a browser has no environment, so neither lane ever sees the other's answer.
 */
function currentSpec(): string | undefined {
    // The DECLARED half through the configured document, so an app may default its own gate; the
    // `localStorage` fallback stays here because it is a lane's answer rather than a knob, and
    // `config()` has no business knowing a browser exists.
    const declared = textKnob('DEBUG')
    if (declared !== null) return declared
    return fromStorage()
}

/** `*` is the only metacharacter; everything else is literal, so a `:` needs no escaping by hand. */
function pattern(text: string): RegExp {
    return new RegExp(`^${text.split('*').map(RegExp.escape).join('.*?')}$`)
}

function compile(spec: string): Gate {
    const includes: RegExp[] = []
    const excludes: RegExp[] = []
    for (const raw of spec.split(/[\s,]+/)) {
        if (raw === '') continue
        if (raw.startsWith('-')) excludes.push(pattern(raw.slice(1)))
        else includes.push(pattern(raw))
    }
    return { includes, excludes }
}

/** Takes the spelling rather than reading it, so a caller can bail on an unset gate without a name. */
function enabledIn(spec: string, channel: string): boolean {
    // Recompiled only when the spelling itself changed, so a hot channel costs one string compare.
    if (spec !== gateSpec) {
        gateSpec = spec
        gate = compile(spec)
    }
    for (const exclude of gate.excludes) if (exclude.test(channel)) return false
    for (const include of gate.includes) if (include.test(channel)) return true
    return false
}

// --- what a line looks like --------------------------------------------------

/**
 * The four forms one line takes. `abide logs` renders a record the feed handed it, and it renders it
 * by the rules the console was already following — so the decision is `logShape()`'s, not a caller's,
 * and nothing outside this file names the type.
 */
type LogShape = 'color' | 'plain' | 'tsv' | 'json'

// A browser is decided by having a document and no terminal behind it: ANSI would arrive as literal
// junk in the console, and a tab is not a field separator anybody there can use.
const IN_BROWSER = typeof document !== 'undefined' && !stdoutIsTTY()

/**
 * One decision, not two. Whether a line is machine-readable and whether it carries color are the
 * same question asked of the same variables, and answering them separately meant keeping the
 * `NO_COLOR` / `FORCE_COLOR` / `isTTY` ordering consistent in two places by hand — so that ordering
 * is `colorAllowed`'s, which the CLI's usage screen asks too.
 *
 * Exported for the tail: a CLI printing somebody else's records answers the same question about its
 * OWN stdout.
 */
export function logShape(): LogShape {
    // Declared beats inferred everywhere, which is also what makes the machine formats testable from a
    // demo that runs in both lanes.
    const declared = textKnob('ABIDE_LOG_FORMAT')
    if (declared === 'json') return 'json'
    if (declared === 'tsv') return 'tsv'
    if (IN_BROWSER) return 'plain'
    return colorAllowed() ? 'color' : 'tsv'
}

// Six that stay legible on both a light and a dark terminal, picked by hashing the channel so one
// channel keeps its color for the life of the process without anything remembering the assignment.
const CHANNEL_COLORS = [36, 35, 34, 33, 32, 31]

function channelColor(channel: string): number {
    let hash = 0
    for (let i = 0; i < channel.length; i++) hash = (hash * 31 + channel.charCodeAt(i)) | 0
    return CHANNEL_COLORS[Math.abs(hash) % CHANNEL_COLORS.length] as number
}

const LEVEL_COLORS: Record<Level, number> = {
    log: 90,
    info: 90,
    warning: 33,
    error: 31,
    debug: 90,
}

/** Probes before it replaces: a message with nothing to escape costs one test. */
function oneLine(message: string): string {
    if (!/[\t\n\r\\]/.test(message)) return message
    return message.replace(/[\t\n\r\\]/g, (ch) =>
        ch === '\t' ? '\\t' : ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\\\',
    )
}

// --- the logger --------------------------------------------------------------

// `debug` rather than `trace`: it already writes to `console.debug`, and `DEBUG` is already the
// variable that decides whether it appears — so the name now matches both its sink and its gate. It
// also frees the word: `trace` in this codebase means the W3C trace id and nothing else, and a LEVEL
// called `trace` sitting next to a FIELD called `trace` was one collision too many.
export type Level = 'log' | 'info' | 'warning' | 'error' | 'debug'

/**
 * One line, as the five fields a machine reads. The same shape `json` writes, because it IS the
 * record — a sixth field here would be a field one format has and the others do not.
 */
export interface LogRecord {
    /** ISO-8601, the spelling every machine format uses. */
    time: string
    level: Level
    channel: string
    message: string
    /**
     * The W3C trace id this line belongs to, or `null` outside a request.
     *
     * Always PRESENT, never omitted: five fields in every format is a contract a reader can hold,
     * and a key that appears only sometimes is one every consumer has to branch on. `null` rather
     * than `''` because "there was no request" and "the request had no id" are the same thing here
     * and neither is an id.
     */
    trace: string | null
}

// A second reader of every line that was WRITTEN — which is the honest thing for a remote feed to
// carry: the gate decides what a line costs, and a tail that showed what the console did not would be
// a second answer to the same question. Installed by `abide/server`, so a browser bundle carries a
// null compare per line and nothing else.
let sink: ((record: LogRecord) => void) | null = null
// The gate comes WITH the sink rather than living inside it: the feed is closed by default, and a
// record built for a closed one is a `Date` and a five-field object allocated per line to be thrown
// away. Asked per line, so an app — or a test — can open the feed without reloading anything.
let sinkWants: () => boolean = () => false

/** Installed by `abide/server`'s log feed. `wants` is asked before a record is built. */
export function useLogSink(fn: (record: LogRecord) => void, wants: () => boolean): void {
    sink = fn
    sinkWants = wants
}

/**
 * How much of a trace id a human sees on a terminal.
 *
 * Eight hex is enough to pick one operation out of a session's worth of lines by eye, and 32 on
 * every line is a wall. The MACHINE formats carry the whole id, so the thing you paste into an APM
 * is never the truncated one — the short form is for finding the line, not for leaving with it.
 */
const READABLE_TRACE = 8

export interface Logger {
    /** One line on this logger's channel. */
    (message: string): void
    info(message: string): void
    warning(message: string): void
    error(message: string): void
    debug(message: string): void
    /**
     * A named sub-channel, prefixed with this one: `log.channel('cards')` on an app called `docs`
     * writes under `docs:cards`, which is what `DEBUG=docs:cards` names. Off unless `DEBUG` says
     * otherwise — except `warning` and `error`, which the gate never swallows.
     */
    channel(name: string): Logger
    /**
     * Whether a gated line on this channel would be written.
     *
     * For the call sites whose MESSAGE is the expensive part. An argument is evaluated before the
     * gate is ever asked, so a line interpolating a method, a path and a duration allocates that
     * string per request with `DEBUG` unset — which is the whole reason a per-request line could not
     * be left in the code before this existed. `warning` and `error` are never gated, so nothing
     * writing one has a reason to ask, and the app's own channel answers `true`.
     */
    enabled(): boolean
}

/**
 * `null` root means "whatever the app is called", resolved per line so `ABIDE_APP_NAME` is live.
 * abide's own logger pins `abide`, because the framework's channels are named after the framework
 * however the app that embeds it is named.
 */
function make(root: string | null, path: string): Logger {
    // The root channel is the app's own output, and that is the one thing the gate never reaches.
    const gated = path !== ''
    // Rebuilt only when the app's name itself changed, so a channel nobody turned on costs a compare
    // rather than a concat on every call that never writes.
    let builtFrom: string | null = null
    let built = ''
    // The `+Nms` delta belongs to the channel, so it lives on the one logger that channel has rather
    // than in a second module-wide map keyed by the name again.
    let lastAt = 0
    // Sub-channels by their BARE name — this logger's identity already carries the prefix, so an ask
    // composes no key and allocates no string on a hit. Built on the first ask; most loggers are leaves.
    let children: Map<string, Logger> | null = null

    const channelOf = (): string => {
        const base = root ?? appName()
        if (base !== builtFrom) {
            builtFrom = base
            built = gated ? `${base}:${path}` : base
        }
        return built
    }

    // Assumes `gated` — both callers test it first, and the root channel has no gate to ask about.
    // The gate is asked BEFORE the channel name is built: a suppressed channel is the case that has
    // to be cheap, and a spelling nobody set answers it without touching the name at all.
    const open = (): boolean => {
        const spec = currentSpec()
        return spec !== undefined && enabledIn(spec, channelOf())
    }

    const write = (level: Level, message: string): void => {
        if (gated && level !== 'warning' && level !== 'error' && !open()) return
        const now = Date.now()
        const since = lastAt === 0 ? 0 : now - lastAt
        lastAt = now
        emit(level, channelOf(), message, now, since)
    }

    const logger = ((message: string): void => {
        write('log', message)
    }) as Logger

    logger.info = (message) => {
        write('info', message)
    }
    logger.warning = (message) => {
        write('warning', message)
    }
    logger.error = (message) => {
        write('error', message)
    }
    logger.debug = (message) => {
        write('debug', message)
    }
    logger.enabled = () => !gated || open()
    logger.channel = (name) => {
        if (name === '') throw new Error('abide: log.channel() needs a name')
        if (children === null) children = new Map()
        const held = children.get(name)
        if (held !== undefined) return held
        const made = make(root, gated ? `${path}:${name}` : name)
        children.set(name, made)
        return made
    }

    return logger
}

function emit(level: Level, channel: string, message: string, now: number, since: number): void {
    // Which operation this line belongs to. Asked once and used by all three shapes and the feed, so
    // a line is never two different answers — and `null` on a client, or on a server outside a
    // request. Asked only for a line being WRITTEN: the gate has already run by here.
    const traced = traceId()

    const form = logShape()
    // ISO-8601 is what the feed and both machine formats carry, and formatting one costs more than
    // everything else on this path put together — so it is built once, for the readers that exist.
    const feeding = sink !== null && sinkWants()
    const stamped = feeding || form === 'json' || form === 'tsv' ? new Date(now).toISOString() : ''

    // Before the console, and OUTSIDE whichever shape is in force: a feed carries records rather than
    // rendered lines, so a reader of it is not decoding whatever `ABIDE_LOG_FORMAT` happened to be.
    if (feeding) {
        ;(sink as (record: LogRecord) => void)({
            time: stamped,
            level,
            channel,
            message,
            trace: traced,
        })
    }

    writeLogLine(level, formatLogLine(level, channel, message, stamped, traced, since, form))
}

/**
 * The five fields as the line one shape writes.
 *
 * POSITIONAL rather than taking a `LogRecord`, because the writer above does not have one and must
 * not have to build one: a record costs an object and — worse — the ISO string, which is the most
 * expensive thing on this path and is skipped outright for a terminal. A reader that HAS a record
 * spreads its fields in, which is the cheap direction.
 */
export function formatLogLine(
    level: Level,
    channel: string,
    message: string,
    stamped: string,
    traced: string | null,
    since: number,
    form: LogShape,
): string {
    if (form === 'json') return JSON.stringify({ time: stamped, level, channel, message, trace: traced })
    // Five columns always, empty where there is no id: a row whose column count depends on whether a
    // request was in flight is one no `cut -f` can read.
    if (form === 'tsv') return `${stamped}\t${level}\t${channel}\t${oneLine(message)}\t${traced ?? ''}`

    const delta = `+${since}ms`
    const suffix = level === 'log' ? '' : ` ${level}`
    // Short, and trailing with the delta rather than leading: both are metadata about the line, and
    // the message is what someone reading a terminal is scanning for.
    const short = traced === null ? '' : ` ${traced.slice(0, READABLE_TRACE)}`
    if (form !== 'color') return `${channel}${suffix} ${message}${short} ${delta}`
    return (
        `\x1b[${channelColor(channel)}m${channel}\x1b[0m` +
        (suffix === '' ? '' : `\x1b[${LEVEL_COLORS[level]}m${suffix}\x1b[0m`) +
        ` ${message}\x1b[90m${short} ${delta}\x1b[0m`
    )
}

/**
 * Where a line goes.
 *
 * Failures go to stderr in every format — that is the one routing decision a pipe cannot make for
 * itself, and it holds whether the other end is a terminal or a collector. The other three are named
 * rather than folded into `console.log` because a browser console filters by them.
 */
export function writeLogLine(level: Level, line: string): void {
    if (level === 'error') console.error(line)
    else if (level === 'warning') console.warn(line)
    else if (level === 'info') console.info(line)
    else if (level === 'debug') console.debug(line)
    else console.log(line)
}

/**
 * The app's logger. Writes on the app's own channel — `ABIDE_APP_NAME`, else package.json's `name`,
 * else `abide` — and that channel is never gated: an app's own output is not debug output.
 */
export const log: Logger = make(null, '')

/**
 * abide's own. Rooted at `abide` however the embedding app is named, so `DEBUG=abide:*` turns on the
 * framework and nothing else. Not on the public surface: an app reaches for `log`.
 */
export const abideLog: Logger = make('abide', '')
