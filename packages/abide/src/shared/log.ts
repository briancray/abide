// The one place anything writes to a console.
//
// Isomorphic like the rest of this surface: the same `log('…')` on both sides, with the two lanes
// differing only in where the gate is read from and what a line is allowed to look like. The gating
// rules and the line shapes are spec'd in docs/SPEC.md; what is here is why the code is shaped the
// way it is. The one rule worth restating at the code: `warning` and `error` are never gated, on any
// channel, because the gate exists to control volume rather than to hide breakage.

// Where the environment is, if there is one. The OBJECT is captured, not its values: `Bun.env` is a
// live view of `process.env`, so a test that sets `DEBUG` mid-run is seen by the next line.
const ENVIRONMENT: Record<string, string | undefined> =
    (globalThis as { Bun?: { env: Record<string, string | undefined> } }).Bun?.env ??
    (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ??
    {}

const STDOUT = (globalThis as { process?: { stdout?: { isTTY?: boolean } } }).process?.stdout

/** Empty string and unset are the same answer — `DEBUG=` is not a request to enable nothing. */
function env(name: string): string | undefined {
    const held = ENVIRONMENT[name]
    return held === undefined || held === '' ? undefined : held
}

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

function appName(): string {
    const declared = env('ABIDE_APP_NAME')
    if (declared !== undefined) return declared
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
    const declared = env('DEBUG')
    if (declared !== undefined) return declared
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

type Shape = 'colour' | 'plain' | 'tsv' | 'json'

// A browser is decided by having a document and no terminal behind it: ANSI would arrive as literal
// junk in the console, and a tab is not a field separator anybody there can use.
const IN_BROWSER = typeof document !== 'undefined' && STDOUT?.isTTY !== true

/**
 * One decision, not two. Whether a line is machine-readable and whether it carries colour are the
 * same question asked of the same three variables, and answering them separately meant keeping the
 * `NO_COLOR` / `FORCE_COLOR` / `isTTY` ordering consistent in two places by hand.
 */
function shape(): Shape {
    // Declared beats inferred everywhere, which is also what makes the machine formats testable from a
    // demo that runs in both lanes.
    const declared = env('ABIDE_LOG_FORMAT')
    if (declared === 'json') return 'json'
    if (declared === 'tsv') return 'tsv'
    if (IN_BROWSER) return 'plain'
    if (env('NO_COLOR') !== undefined) return 'tsv'
    if (env('FORCE_COLOR') !== undefined) return 'colour'
    return STDOUT?.isTTY === true ? 'colour' : 'tsv'
}

// Six that stay legible on both a light and a dark terminal, picked by hashing the channel so one
// channel keeps its colour for the life of the process without anything remembering the assignment.
const CHANNEL_COLOURS = [36, 35, 34, 33, 32, 31]

function channelColour(channel: string): number {
    let hash = 0
    for (let i = 0; i < channel.length; i++) hash = (hash * 31 + channel.charCodeAt(i)) | 0
    return CHANNEL_COLOURS[Math.abs(hash) % CHANNEL_COLOURS.length] as number
}

const LEVEL_COLOURS: Record<Level, number> = {
    log: 90,
    info: 90,
    warning: 33,
    error: 31,
    trace: 90,
}

/** Probes before it replaces: a message with nothing to escape costs one test. */
function oneLine(message: string): string {
    if (!/[\t\n\r\\]/.test(message)) return message
    return message.replace(/[\t\n\r\\]/g, (ch) =>
        ch === '\t' ? '\\t' : ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\\\',
    )
}

// --- the logger --------------------------------------------------------------

export type Level = 'log' | 'info' | 'warning' | 'error' | 'trace'

export interface Logger {
    /** One line on this logger's channel. */
    (message: string): void
    info(message: string): void
    warning(message: string): void
    error(message: string): void
    trace(message: string): void
    /**
     * A named sub-channel, prefixed with this one: `log.channel('cards')` on an app called `docs`
     * writes under `docs:cards`, which is what `DEBUG=docs:cards` names. Off unless `DEBUG` says
     * otherwise — except `warning` and `error`, which the gate never swallows.
     */
    channel(name: string): Logger
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

    const write = (level: Level, message: string): void => {
        // The gate is asked BEFORE the channel name is built. A suppressed channel is the case that
        // has to be cheap, and a spelling nobody set answers it without touching the name at all.
        if (gated && level !== 'warning' && level !== 'error') {
            const spec = currentSpec()
            if (spec === undefined || !enabledIn(spec, channelOf())) return
        }
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
    logger.trace = (message) => {
        write('trace', message)
    }
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
    const form = shape()
    let line: string
    if (form === 'json') {
        line = JSON.stringify({
            time: new Date(now).toISOString(),
            level,
            channel,
            message,
        })
    } else if (form === 'tsv') {
        line = `${new Date(now).toISOString()}\t${level}\t${channel}\t${oneLine(message)}`
    } else {
        const delta = `+${since}ms`
        const suffix = level === 'log' ? '' : ` ${level}`
        line =
            form === 'colour'
                ? `\x1b[${channelColour(channel)}m${channel}\x1b[0m` +
                  (suffix === '' ? '' : `\x1b[${LEVEL_COLOURS[level]}m${suffix}\x1b[0m`) +
                  ` ${message} \x1b[90m${delta}\x1b[0m`
                : `${channel}${suffix} ${message} ${delta}`
    }

    // Failures go to stderr in every format — that is the one routing decision a pipe cannot make for
    // itself, and it holds whether the other end is a terminal or a collector.
    if (level === 'error') console.error(line)
    else if (level === 'warning') console.warn(line)
    else if (level === 'info') console.info(line)
    else if (level === 'trace') console.debug(line)
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
