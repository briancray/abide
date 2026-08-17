// The one place anything writes to a console.
//
// Isomorphic like the rest of this surface: the same `log('…')` on both sides, with the two lanes
// differing only in where the gate is read from and what a line is allowed to look like. The gating
// rules and the line shapes are spec'd in docs/SPEC.md; what is here is why the code is shaped the
// way it is. The one rule worth restating at the code: `warning` and `error` are never gated, on any
// channel, because the gate exists to control volume rather than to hide breakage.

import { textKnob } from './internal/knobs.ts'
import { traceId } from './internal/trace.ts'

// --- the app's own name ------------------------------------------------------

// `ABIDE_APP_NAME`, then package.json's `name`, then `abide`. The middle one needs a filesystem, so
// it arrives through a source `abide/server` installs at import — eagerly, unlike the scope and href
// sources, because a line can be written long before anything calls `serve()`. That keeps `#shared`
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
 * One written line, as text. The `now` is a millisecond stamp rather than a formatted one: only the
 * machine forms carry a timestamp at all, and building the ISO string is the most expensive thing on
 * this path — so whoever writes the line decides whether to pay for it.
 */
export type LineWriter = (
    level: Level,
    channel: string,
    message: string,
    now: number,
    traced: string | null,
    since: number,
) => string

/**
 * How much of a trace id a human sees on a terminal.
 *
 * Eight hex is enough to pick one operation out of a session's worth of lines by eye, and 32 on
 * every line is a wall. The MACHINE formats carry the whole id, so the thing you paste into an APM
 * is never the truncated one — the short form is for finding the line, not for leaving with it.
 */
const READABLE_TRACE = 8

/**
 * The readable form, and the only one a browser can be in — so it is the one that lives here.
 *
 * `logShape()` answers `plain` for a document with no terminal behind it and nothing can move that:
 * the other three are declared through `ABIDE_LOG_FORMAT` or inferred from a TTY, and a client has
 * neither. They are in `internal/lines.ts` and reach a line only through `useLineWriter` below.
 */
export const plainLine: LineWriter = (level, channel, message, _now, traced, since) => {
    return `${channel}${levelSuffix(level)} ${message}${shortTrace(traced)} +${since}ms`
}

/** The level, or nothing at all for a plain `log` — the common line names no level. */
export function levelSuffix(level: Level): string {
    return level === 'log' ? '' : ` ${level}`
}

/**
 * The trace id, short and TRAILING rather than leading: both it and the delta are metadata about the
 * line, and the message is what someone reading a terminal is scanning for.
 */
export function shortTrace(traced: string | null): string {
    return traced === null ? '' : ` ${traced.slice(0, READABLE_TRACE)}`
}

// What the three TERMINAL forms are installed over. A browser never replaces it, which is the whole
// point: `internal/lines.ts` carries the ANSI tables, the tab escaping and the ISO stamping, and
// nothing a client bundle imports reaches that file.
let lineWriter: LineWriter = plainLine

/** Installed by `abide/server` at import, beside `useAppNameSource`. See `internal/lines.ts`. */
export function useLineWriter(writer: LineWriter): void {
    lineWriter = writer
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
 * What a call was handed, console's shape: any number of arguments, of any type.
 *
 * The FIRST composes the line, because a line is what a channel prefix, a level, a trace id and a
 * `+Nms` delta attach to — a string is used as it stands, anything else through `String`, so
 * `log.error(err)` reads as `Error: no such row` and the error itself still travels. Every argument
 * the line did not consume goes to the console untouched, which is the whole point: a stack survives
 * as an object and does not survive interpolation.
 *
 * Nothing here SUBSTITUTES — no `%s` handling of its own — but nothing is stripped either, so a
 * specifier reaches the console and behaves however that console behaves. That is passthrough rather
 * than a contract: `%c` styles a line in a browser and means nothing on a terminal, and which of those
 * you get is a property of where you are reading, which the caller already knows and this file does not.
 */
type LogArgs = readonly unknown[]

export interface Logger {
    /** One line on this logger's channel. */
    (...args: LogArgs): void
    info(...args: LogArgs): void
    warning(...args: LogArgs): void
    error(...args: LogArgs): void
    debug(...args: LogArgs): void
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

/** Shared, so a caller that passes no extras allocates no array to say so. Above its first reader. */
const NO_EXTRAS: LogArgs = []

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

    const write = (level: Level, args: LogArgs): void => {
        if (gated && level !== 'warning' && level !== 'error' && !open()) return
        const now = Date.now()
        const since = lastAt === 0 ? 0 : now - lastAt
        lastAt = now
        // A STRING first argument is consumed by the line; anything else is rendered into the line
        // AND passed along, because `String(err)` is `name: message` and the stack is only in the
        // object. Consuming it both ways is what makes `log.error(err)` read the way it does on a
        // console: a titled line, with the error under it to open.
        //
        // `String` is identity on a string, so one `emit` covers both — only the EXTRAS differ, and the
        // ordinary `log('…')` takes `NO_EXTRAS` rather than allocating the empty array `slice` would.
        const head = args[0]
        const rest = typeof head !== 'string' ? args : args.length === 1 ? NO_EXTRAS : args.slice(1)
        emit(level, channelOf(), args.length === 0 ? '' : String(head), now, since, rest)
    }

    const logger = ((...args: LogArgs): void => {
        write('log', args)
    }) as Logger

    logger.info = (...args) => {
        write('info', args)
    }
    logger.warning = (...args) => {
        write('warning', args)
    }
    logger.error = (...args) => {
        write('error', args)
    }
    logger.debug = (...args) => {
        write('debug', args)
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

/**
 * What the FEED carries for a line that had extras, which the console gets as live objects.
 *
 * Folded into `message` rather than added as a sixth field — see `LogRecord`. A collector is where a
 * stack is worth the most and is also the one reader that cannot expand an object, so an `Error`
 * contributes its `stack` (already `name: message` on its first line in both substrates) and anything
 * else its `String`. Built only when the feed is open, and only for the lines that carried something.
 */
function recordMessage(message: string, rest: LogArgs): string {
    if (rest.length === 0) return message
    let built = message
    for (const extra of rest) {
        const stack = extra instanceof Error ? extra.stack : undefined
        built += `\n${stack ?? String(extra)}`
    }
    return built
}

function emit(
    level: Level,
    channel: string,
    message: string,
    now: number,
    since: number,
    rest: LogArgs,
): void {
    // Which operation this line belongs to. Asked once and used by all three shapes and the feed, so
    // a line is never two different answers — and `null` on a client, or on a server outside a
    // request. Asked only for a line being WRITTEN: the gate has already run by here.
    const traced = traceId()

    // Before the console, and OUTSIDE whatever shape is in force: a feed carries records rather than
    // rendered lines, so a reader of it is not decoding whatever `ABIDE_LOG_FORMAT` happened to be.
    // It builds its own ISO stamp — which is the most expensive thing on this path — because `emit`
    // no longer knows whether the writer wants one. See `internal/lines.ts` for what that costs.
    if (sink !== null && sinkWants()) {
        sink({
            time: new Date(now).toISOString(),
            level,
            channel,
            message: recordMessage(message, rest),
            trace: traced,
        })
    }

    writeLogLine(level, lineWriter(level, channel, message, now, traced, since), rest)
}

/**
 * Where a line goes.
 *
 * Failures go to stderr in every format — that is the one routing decision a pipe cannot make for
 * itself, and it holds whether the other end is a terminal or a collector. The other three are named
 * rather than folded into `console.log` because a browser console filters by them.
 */
export function writeLogLine(level: Level, line: string, rest: LogArgs = NO_EXTRAS): void {
    // Spread rather than a second five-way branch for the empty case: the gate has already run, so
    // everything reaching here is doing a console call, and that dwarfs the spread. The path worth
    // keeping cheap is the SUPPRESSED one, and it returns in `write` without ever arriving.
    if (level === 'error') console.error(line, ...rest)
    else if (level === 'warning') console.warn(line, ...rest)
    else if (level === 'info') console.info(line, ...rest)
    else if (level === 'debug') console.debug(line, ...rest)
    else console.log(line, ...rest)
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
