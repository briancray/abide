// SECTION 27 — THE RESOLVED CONFIGURATION. One process-wide value (27.9) over three layers, the last
// winning (27.2): what abide derives, what the app's `onConfig` defaulted, and the environment.
//
// A `reactive` BODY, so `config.invalidate` is the core's own trigger and reruns all of it (27.5),
// and a throw out of `onConfig` is the value's standing error, which a read throws (27.1).

import { homedir } from 'node:os' // bun exposes no home directory of its own

import { isRecord } from '#shared/isRecord.ts'
import { numberFromText } from '#shared/numberFromText.ts'
import { processWide } from '#shared/reactive/index.ts'
import { refuse } from '#shared/refuse.ts'
import { runSchema } from '#shared/Schema.ts'
import { UNNAMED } from '#shared/UNNAMED.ts'

import { executableName } from './executableName.ts'
import { type Env, HOOKS, inOrder } from './hooks.ts'
import { packageDirectory } from './packageDirectory.ts'
import { UNVERSIONED } from './UNVERSIONED.ts'
import { withoutTrailingSlash } from './withoutTrailingSlash.ts'

/** The fields of an app's `package.json` 27.3 derives from. */
export type AppPackage = {
    name?: string | undefined
    version?: string | undefined
}

/**
 * The app's own `package.json`, for 27.3's derivation — set by `bootApp` before `config` is read.
 *
 * HELD RATHER THAN FOUND: a compiled app has no directory to find it in, so what is read here is
 * what the boot was handed.
 */
export const APP_PACKAGE: { current: AppPackage } = { current: {} }

/** The `package.json` of an app on disk (`packageDirectory`), or nothing where it has none. */
export function packageUnder(root: string): AppPackage {
    try {
        return require(`${packageDirectory(root)}/package.json`) as AppPackage
    } catch {
        return {}
    }
}

/**
 * The resolved document, which an app widens by declaration merging.
 *
 * `unknown` UNDER THE NAMED FIELDS rather than `Env`'s text: a default an app declares is coerced to
 * its own type (27.8) and a schema may make anything of the document (27.7), so a field an app
 * merges in as a `number` has to be one the index admits.
 */
export interface Config {
    [field: string]: unknown
    APP_NAME: string
    APP_VERSION: string
    APP_DATA_DIR: string
}

// What a preload derives beside 27.3's three — the test preload's principal secret (38.120). Declared
// above `config`, which resolves as it is built — and so is invalidated by an addition.
const ADDED: Record<string, string> = {}

/** Adds `values` to the derived layer, so every `onConfig` default and the env still win (27.2). */
export function addDerived(values: Record<string, string>): void {
    Object.assign(ADDED, values)
    config.invalidate()
}

/** The resolved configuration: abide's derived values, then `onConfig`'s defaults, then the env. */
export const config = processWide(resolve)

function resolve(): Config {
    const document = unchecked()
    // 27.7 — LAST, each over the whole document, and what each accepts merged back over it.
    for (const { options } of inOrder(HOOKS.config)) {
        const schema = options?.schema
        if (schema === undefined) continue
        const checked = runSchema(schema, document)
        if (checked.issues !== null)
            return refuse.validation(checked.issues as never) as never
        if (isRecord(checked.value)) Object.assign(document, checked.value)
    }
    return document as Config
}

/** The document before any `onConfig` schema has checked it: 27.2's three layers, merged. */
function unchecked(): Record<string, unknown> {
    const env: Env = { ...process.env }
    // 27.11 — handed what 27.3 derives under the environment, so a default can be built on
    // `APP_DATA_DIR` without deriving it a second time.
    const derivedValues = derived()
    const document: Record<string, unknown> = { ...derivedValues }
    // 27.6, 37.7 — EVERY `onConfig`'S DEFAULTS, merged over the ones before it.
    for (const { defaults } of inOrder(HOOKS.config)) {
        const given = defaults?.({ ...derivedValues, ...env }) ?? {}
        // 27.4 — SYNCHRONOUS BY CONTRACT; a promise handed back is a contract broken, not a value.
        if (given instanceof Promise)
            throw new Error(
                'abide: onConfig returned a promise. ConfigDefaults is synchronous; read what the defaults need before registering them. RULEBOOK 27.4.',
            )
        Object.assign(document, given as Record<string, unknown>)
    }
    // 27.8 — THE ENVIRONMENT, COERCED TO THE DEFAULT IT OVERRIDES; a value that will not coerce leaves
    // the default standing.
    for (const [name, text] of Object.entries(env)) {
        if (text === undefined) continue
        const coerced = coerce(text, document[name])
        if (coerced !== undefined) document[name] = coerced
    }
    return document
}

/**
 * 38.87 — the name the native app shows: `APP_NAME` where `onConfig`'s defaults or the environment
 * carry one, else the package name as 38.46 names the executable. Read before any schema, which may
 * require what only the launcher's start form supplies.
 */
export function shownName(): string {
    const named = beforeSchema('APP_NAME')
    return typeof named === 'string' &&
        named !== '' &&
        named !== derived().APP_NAME
        ? named
        : executableName(APP_PACKAGE.current.name)
}

/**
 * 38.73 — where the native launcher remembers what it did: `APP_DATA_DIR` as the environment and
 * `onConfig`'s defaults set it, else the derived one — read before any schema, for `shownName`'s
 * reason, and before any start, since what a start sends is among what it remembers.
 */
export function launcherDataDirectory(): string {
    const directory = beforeSchema('APP_DATA_DIR')
    return typeof directory === 'string' && directory !== ''
        ? directory
        : dataDirectory(APP_PACKAGE.current.name ?? UNNAMED)
}

/** One value of the document before any schema, or `undefined` where `onConfig`'s defaults threw. */
function beforeSchema(name: string): unknown {
    try {
        return unchecked()[name]
    } catch {
        // 27.1 — what `onConfig` threw is the boot's to report.
        return undefined
    }
}

function coerce(text: string, standing: unknown): unknown {
    if (typeof standing === 'number') return numberFromText(text)
    if (typeof standing === 'boolean') {
        const lowered = text.toLowerCase()
        if (lowered === 'true' || lowered === '1') return true
        if (lowered === 'false' || lowered === '0') return false
        return undefined
    }
    return text
}

/**
 * The app's name, version and data directory, off its own `package.json` and the platform, and
 * what `addDerived` added.
 *
 * 27.3 — a layer under the other two, so a config or an environment that carries one wins.
 */
export function derived(): Record<string, string> {
    const manifest = APP_PACKAGE.current
    const name = manifest.name ?? UNNAMED
    return {
        ...ADDED,
        APP_NAME: name,
        APP_VERSION: manifest.version ?? UNVERSIONED,
        // 36.4 — A PATH, and never created here: an app that wants the directory makes it, or opens a
        // `database` (47.2).
        APP_DATA_DIR: dataDirectory(name),
    }
}

/** 27.3's `APP_DATA_DIR` for an app named `name`, on this platform. */
export function dataDirectory(name: string): string {
    const home = homedir()
    if (process.platform === 'darwin')
        return `${home}/Library/Application Support/${name}`
    if (process.platform === 'win32')
        return `${process.env.APPDATA ?? `${home}/AppData/Roaming`}/${name}`
    return `${process.env.XDG_DATA_HOME ?? `${home}/.local/share`}/${name}`
}

// 28.4 — THE APP'S NAME IS `log`'s ROOT NAMESPACE, and the config is where the name is decided.
// PEEKED, so a log line written inside an effect does not subscribe it to the configuration.
export function derivedAppName(): string | undefined {
    const resolved = config.peek()
    return typeof resolved?.APP_NAME === 'string'
        ? resolved.APP_NAME
        : undefined
}

/**
 * The name and version an app reports as itself, where a surface outside the app asks.
 *
 * `derived` supplies both, so the fallbacks only answer before the configuration has resolved.
 */
export function appIdentity(): { name: string; version: string } {
    const resolved = config.peek()
    return {
        name: String(resolved?.APP_NAME ?? UNNAMED),
        version: String(resolved?.APP_VERSION ?? UNVERSIONED),
    }
}

/** A setting that must be a positive number, and `fallback` where it is not one. */
export function positiveSetting<Fallback extends number | undefined>(
    name: string,
    fallback: Fallback,
): number | Fallback {
    const declared = Number(config.peek()?.[name])
    return Number.isFinite(declared) && declared > 0 ? declared : fallback
}

/**
 * Whether the switch `name` is on: `true`, or text reading `true` or `1` in any case, as 27.8 coerces
 * one over a boolean default — and off where it is unset or reads as anything else.
 *
 * 45.14.
 */
export function settingOn(name: string): boolean {
    const declared = config.peek()?.[name]
    if (typeof declared === 'boolean') return declared
    return typeof declared === 'string' && coerce(declared, false) === true
}

// 36.2 — `APP_URL`, parsed once per text it holds, and `undefined` where there is none or it will not
// parse. Read through the configuration, so an environment that moves it moves every address.
let appUrlFor: string | undefined
let appUrlIs: URL | undefined
let mountIs = ''
function appUrl(): URL | undefined {
    const declared = config.peek()?.APP_URL
    const text = typeof declared === 'string' ? declared : ''
    if (text !== appUrlFor) {
        appUrlFor = text
        appUrlIs = text === '' ? undefined : (URL.parse(text) ?? undefined)
        mountIs =
            appUrlIs === undefined
                ? ''
                : withoutTrailingSlash(appUrlIs.pathname)
    }
    return appUrlIs
}

// 36.24 — `APP_ORIGINS`, parsed once per text it and `APP_URL` hold: `APP_URL`'s origin, then each
// entry, a bare host taking `APP_URL`'s scheme, or `https:` where there is none.
let listedFor: string | undefined
let listedAre: ReadonlySet<string> = new Set()
function listedOrigins(): ReadonlySet<string> {
    const base = appUrl()
    const declared = config.peek()?.APP_ORIGINS
    const text = typeof declared === 'string' ? declared : ''
    const key = `${base?.origin ?? ''} ${text}`
    if (key !== listedFor) {
        listedFor = key
        const scheme = base?.protocol ?? 'https:'
        const origins = new Set<string>()
        if (base !== undefined) origins.add(base.origin)
        for (const entry of text.split(',')) {
            const trimmed = entry.trim()
            if (trimmed === '') continue
            const parsed = URL.parse(
                trimmed.includes('://') ? trimmed : `${scheme}//${trimmed}`,
            )
            if (parsed !== null) origins.add(parsed.origin)
        }
        listedAre = origins
    }
    return listedAre
}

/**
 * The app's own origin for the request at `url`: the request's where `APP_URL` or `APP_ORIGINS`
 * lists it or no `APP_URL` is declared, and `APP_URL`'s where not. 36.2, 36.25.
 */
export function ownOrigin(url: URL | string): string {
    const requested = (typeof url === 'string' ? new URL(url) : url).origin
    const base = appUrl()
    return base === undefined || listedOrigins().has(requested)
        ? requested
        : base.origin
}

/** Whether `origin` is one of the app's own for the request at `url`. 36.2, 36.25. */
export function isOwnOrigin(origin: string, url: URL | string): boolean {
    return origin === ownOrigin(url) || listedOrigins().has(origin)
}

// 36.2, 16.10 — THE MOUNT IS `APP_URL`'s PATH, trailing slash dropped, and the root where there is
// none.
export function configuredMount(): string {
    appUrl()
    return mountIs
}
