// SECTION 27 — THE RESOLVED CONFIGURATION. One process-wide value (27.9) over three layers, the last
// winning (27.2): what abide derives, what the app's `onConfig` defaulted, and the environment.
//
// A `reactive` BODY, so `config.invalidate` is the core's own trigger and re-runs all of it (27.5),
// and a throw out of `onConfig` is the value's standing error, which a read throws (27.1).

import { homedir } from 'node:os' // bun exposes no home directory of its own
import { APP_NAME } from '#shared/log.ts'
import { MOUNT } from '#shared/mount.ts'
import { reactive } from '#shared/reactive/index.ts'
import { validationError } from '#shared/refuse.ts'
import { numberFromText } from '#shared/numberFromText.ts'
import { runSchema } from '#shared/Schema.ts'
import { type Env, HOOKS } from './hooks.ts'

// The app's root, for 27.3's derivation — set by `bootApp` before the value is first read.
export const CONFIG_ROOT: { current: string } = { current: process.cwd() }

export interface Config extends Env {}

export const config = reactive(resolve, { global: true })

function resolve(): Config {
    const env: Env = { ...process.env }
    const hooked = HOOKS.config
    // 27.4 — SYNCHRONOUS BY CONTRACT; a promise handed back is a contract broken, not a value.
    const defaults = hooked?.defaults?.(env) ?? {}
    if (defaults instanceof Promise)
        throw new Error(
            'abide: onConfig returned a promise. ConfigDefaults is synchronous; read what the defaults need before registering them. RULEBOOK 27.4.',
        )
    const document: Record<string, unknown> = {
        // 36.7 — CLOSED BY DEFAULT, and a boolean, so 27.8 reads the environment's spelling of one.
        ABIDE_LOGS: false,
        ABIDE_OPENAPI: false,
        ABIDE_MCP: false,
        ...derived(),
        ...(defaults as Record<string, unknown>),
    }
    // 27.8 — THE ENVIRONMENT, COERCED TO THE DEFAULT IT OVERRIDES; a value that will not coerce leaves
    // the default standing.
    for (const [name, text] of Object.entries(env)) {
        if (text === undefined) continue
        const coerced = coerce(text, document[name])
        if (coerced !== undefined) document[name] = coerced
    }
    // 27.7 — LAST, over the whole document.
    const schema = hooked?.options?.schema
    if (schema === undefined) return document as Config
    const checked = runSchema(schema, document)
    if (checked.issues !== null)
        return validationError(checked.issues as never) as never
    return checked.value as Config
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

// 27.3 — THE APP'S NAME, VERSION AND DATA DIRECTORY, off the app's own `package.json` and the platform.
// A layer under the other two, so a config or an environment that carries one wins.
function derived(): Record<string, string> {
    const root = CONFIG_ROOT.current
    let manifest: { name?: string; version?: string } = {}
    for (const at of [`${root}/package.json`, `${root}/../package.json`]) {
        try {
            manifest = require(at) as typeof manifest
            break
        } catch {}
    }
    const name = manifest.name ?? 'app'
    return {
        APP_NAME: name,
        APP_VERSION: manifest.version ?? '0.0.0',
        // 36.4 — A PATH, and never created: an app that wants the directory makes it.
        APP_DATA_DIR: dataDirectory(name),
    }
}

function dataDirectory(name: string): string {
    const home = homedir()
    if (process.platform === 'darwin')
        return `${home}/Library/Application Support/${name}`
    if (process.platform === 'win32')
        return `${process.env.APPDATA ?? `${home}/AppData/Roaming`}/${name}`
    return `${process.env.XDG_DATA_HOME ?? `${home}/.local/share`}/${name}`
}

// 28.4 — THE APP'S NAME IS `log`'s ROOT NAMESPACE, and the config is where the name is decided.
// PEEKED, so a log line written inside an effect does not subscribe it to the configuration.
APP_NAME.derived = (): string | undefined => {
    const resolved = config.peek()
    return typeof resolved?.APP_NAME === 'string'
        ? resolved.APP_NAME
        : undefined
}

// The name and version an app reports as itself, where a surface outside the app asks. `derived`
// supplies both, so the fallbacks only answer before the configuration has resolved.
export function appIdentity(): { name: string; version: string } {
    const resolved = config.peek()
    return {
        name: String(resolved?.APP_NAME ?? 'app'),
        version: String(resolved?.APP_VERSION ?? '0.0.0'),
    }
}

// A setting that must be a positive number, and `fallback` where it is not one.
export function positiveSetting<Fallback extends number | undefined>(
    name: string,
    fallback: Fallback,
): number | Fallback {
    const declared = Number(config.peek()?.[name])
    return Number.isFinite(declared) && declared > 0 ? declared : fallback
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
        appUrlIs = undefined
        try {
            if (text !== '') appUrlIs = new URL(text)
        } catch {}
        mountIs = appUrlIs?.pathname.replace(/\/+$/, '') ?? ''
    }
    return appUrlIs
}

// 36.2 — the app's own origin, where `APP_URL` declares one.
export function appOrigin(): string | undefined {
    return appUrl()?.origin
}

// 36.2, 16.11 — THE MOUNT IS `APP_URL`'s PATH, trailing slash dropped, and the root where there is
// none.
MOUNT.current = (): string => {
    appUrl()
    return mountIs
}
