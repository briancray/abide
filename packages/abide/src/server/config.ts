// `config()` — the environment, typed, with the app's own defaults under it.
//
// ONE SPELLING: a field's name IS the variable's name. `config().PORT` is `PORT`, and
// `config().STRIPE_KEY` is `STRIPE_KEY` — an app's own field is overridable by an operator exactly as
// abide's are, because there is no rule saying which is which. No mapping table, no camelCase
// derivation, nothing to look up. That is the whole of why the fields below are shouted.
//
// Two layers, and the order is the design: the app's DEFAULTS, then what the operator DECLARED. The
// app losing is what makes a default a default — `onConfig(() => ({ PORT: 8080 }))` says "8080 unless
// somebody set PORT", and a default that beat the environment would be a knob that does nothing. This
// is the opposite of how `onHealth` and `onIdentity` merge, and deliberately: those are the app
// ASSERTING something it knows better than the framework does, and a config field is the app
// REQUESTING something the operator may overrule.
//
// Only VARIABLES live here. A conclusion drawn from one is not a variable and does not belong in the
// document: `NODE_ENV` is the field, `isProduction()` is the conclusion; `ABIDE_DATA_DIR` is the
// field, `appDataDir()` resolves it against the platform. Keeping a derived answer here would be a
// second spelling of something already exported, and two spellings is how they come to disagree.
//
// The SOURCE, not a report. Every knob abide reads is answered from this document rather than off
// `Bun.env` at the use site, so a default an app wrote is a default that took effect and there is one
// account of what a process is running on. A path reading the environment itself would be a second
// answer, and `config()` publishing a number nothing honoured is exactly the disagreement an operator
// has no way to catch.
//
// Two seams carry that the whole way. `$shared` may not import `$server`, so the ceilings ask through
// `useConfigSource` — the inversion `useLogSink` and `useIdentitySource` already are, and what leaves
// a browser build on its floor. And an rpc's `timeout` and `maxBodySize` resolve at the DOOR rather
// than at the declaration, because a declaration runs at import and could never have seen a hook
// registered after it.
//
// What stays out is the layer this is BUILT on: `FLOOR` asks `log.ts` for nothing, but `env.ts`
// answers `colorAllowed()` and the `DEBUG` gate composes what is here with what only a lane knows —
// a browser's `localStorage`, a TTY. A read taken DURING a resolve is answered from the layer already
// assembled, and one taken against a REFUSED config is answered by the floor — see `knobOf`.
//
// Server-only, and the one ambient with no wire face at all. `health()` and `identity()` are
// isomorphic because a browser is allowed both answers; half of this document is
// `ABIDE_IDENTITY_SECRET` and `ABIDE_APP_TOKEN`, so there is no `GET /__abide/config` and no browser
// half. An app that wants a public subset publishes one through an rpc, which is one line and is a
// decision somebody made on purpose.

import { env, envNumber } from '$shared/internal/env.ts'
import { useConfigSource } from '$shared/internal/knobs.ts'
import { isThenable } from '$shared/internal/probes.ts'
import { NO_LIMIT } from '$shared/internal/timers.ts'
import { abideLog } from '$shared/log.ts'
import { DEFAULT_PORT } from './internal/DEFAULTS.ts'
import { type Gate, gate, type Schema } from './schema.ts'

/**
 * Every variable abide reads, as the type it actually is.
 *
 * The one place the environment table exists as code. A field is never absent — a floor fills in what
 * nobody declared — so a reader asks one question rather than writing the `?? 3000` half of them
 * forget, which is the same rule `identity()` is never null by.
 *
 * `null` is what a variable nobody set means where there is nothing sensible to invent. A NUMBER's
 * absence has a number to mean it; a secret's does not, and a default one would be a signing key
 * published with the framework.
 */
export interface Env {
    /** Listen port. `--port` on a command overrides it. */
    PORT: number
    /** Verbatim. `isProduction()` is the conclusion drawn from it, and is not a field. */
    NODE_ENV: string | null
    /** In debug-npm grammar. A browser's `localStorage` answers under this, never over it. */
    DEBUG: string | null
    /** Set to anything: no ANSI on stdout, whatever else says. Beats `FORCE_COLOR`. */
    NO_COLOR: string | null
    /** Set to anything: ANSI on stdout even with no TTY. Loses to `NO_COLOR`. */
    FORCE_COLOR: string | null
    /** The app's own public URL, and the origin both gates compare against. */
    APP_URL: string | null
    /** Overrides the name found in the nearest package.json. `appName()` resolves the chain. */
    ABIDE_APP_NAME: string | null
    /** The remote CLI's own variable, naming an app somewhere else. Asked before `APP_URL`. */
    ABIDE_APP_URL: string | null
    /** The bearer the remote CLI sends — for whatever is in FRONT of the app. */
    ABIDE_APP_TOKEN: string | null
    /** Overrides the per-user directory. `appDataDir()` resolves it against the platform. */
    ABIDE_DATA_DIR: string | null
    /** Whether `GET /__abide/logs` is open at all. */
    ABIDE_LOGS: boolean
    /** The remote feed's ring, in RECORDS — a size an operator can reason about without measuring. */
    ABIDE_LOG_BUFFER: number
    /** `null` means the shape follows the TTY, which is the LANE's answer rather than a knob. */
    ABIDE_LOG_FORMAT: 'tsv' | 'json' | null
    /** Seals the identity cookie. Required in production for `identity.set()`. */
    ABIDE_IDENTITY_SECRET: string | null
    /** Identity cookie life, in ms. Rolling — re-sealed on the first resolve past half of it. */
    ABIDE_IDENTITY_TTL: number
    /** ms a call may go without progress. A declaration's own `timeout` is the real knob. */
    ABIDE_RPC_TIMEOUT: number
    /** In bytes. `Infinity` when unset; a declaration's own `maxBodySize` wins. */
    ABIDE_MAX_REQUEST_BODY_SIZE: number
    /** In bytes, over the global memo cache. `Infinity` when unset — see Ceilings. */
    ABIDE_MAX_GLOBAL_CACHE_SIZE: number
    /** In bytes, per stream transcript. `Infinity` when unset — see Ceilings. */
    ABIDE_MAX_STREAM_BUFFER_SIZE: number
    /** In ms, over one streaming render. `Infinity` when unset — see Ceilings. */
    ABIDE_SSR_STREAM_BUDGET: number
}

/**
 * The whole document: the typed environment, plus whatever `onConfig` added to it.
 *
 * The index signature is what makes the app's own fields readable at all, exactly as it is on
 * `Health` and `Identity`. `config<{ STRIPE_KEY: string }>()` is how they get a type — the same
 * spelling `server<WebSocketData>()` uses, for the same reason: only the caller knows.
 */
export interface Config extends Env {
    [field: string]: unknown
}

/**
 * The app's own layer: fields merged UNDER what the environment declared.
 *
 * Receives the typed environment, so a default may be computed from one —
 * `{ POOL: env.NODE_ENV === 'production' ? 20 : 2 }` — and so an app never reaches for `Bun.env` to
 * answer a question this already answered.
 *
 * Whatever it names becomes overridable by a variable of THAT NAME, abide's own fields and the app's
 * alike. Returning `{ STRIPE_KEY: 'sk_test' }` is what makes `STRIPE_KEY=sk_live` mean something.
 *
 * Synchronous by contract. Config is what the process was told before it started, and a hook that
 * returned a promise would make every read of every field a read that has to be awaited. An app whose
 * secrets come from a vault fetches them in `onStart` and registers this before it calls `start()`,
 * which is the one place in the lifecycle where waiting is already the point.
 */
export type ConfigDefaults = (env: Env) => unknown

/**
 * What else a registration may say, beside its defaults.
 *
 * An OBJECT rather than a bare second argument, like every other declaration in abide takes —
 * `GET(fn, { schemas, memo, timeout })`, `socket({ channel, middleware })`. A positional schema here
 * would be the one exception, and it is the shape that cannot grow: the next thing config wants to
 * say about itself — which fields are safe to publish, say — has nowhere to go.
 */
export interface ConfigOptions<Shape> {
    /**
     * The shape the assembled document has to match, checked LAST and over the whole of it.
     *
     * The SAME `Schema` a transport declaration takes — a JSON Schema, a plain function, or a
     * Standard Schema — because a second shape language for the same job is a second thing to learn
     * and a second validator to keep in step.
     */
    schema?: Schema<Shape>
}

export interface Configured {
    /**
     * The document. Resolved on the first ask and held for the process.
     *
     * THROWS what `onConfig` threw, and what its declared shape refused. Unlike `onHealth`, which
     * fails soft because a reporter that throws is still an account, a config that cannot be worked
     * out is a process that cannot be configured — and the safe reading of that is not "serve anyway
     * with a hole in it". `boot` asks before it binds, so a refused config is a process that never
     * listens rather than a 500 on the first request that needed the missing key.
     */
    <Extra extends object = Record<never, never>>(): Config & Extra
    /** Forget it, so the next ask resolves again — what a rotated environment or a new hook needs. */
    invalidate(): void
}

/**
 * One registration, held as one record.
 *
 * The record's IDENTITY is what a disposer compares against, rather than the hook it was given: a
 * `defaults` of `null` is legal — an app that only declared a shape — and two of those compared by
 * value would have the first disposer take the second registration off.
 */
interface Registration {
    defaults: ConfigDefaults | null
    gate: Gate<unknown> | null
}

let REGISTERED: Registration | null = null
let RESOLVED: Config | null = null

// What a resolve THREW, held for the same reason the document is. A refusal is a fact about the
// process, not about the ask: re-running `resolve` per read would run the app's `onConfig` hook again
// for every knob the logger touches, and `knobOf` is on the per-request, per-log-line and per-settle
// paths. Dropped wherever `RESOLVED` is, so `invalidate()` and a new registration both retry.
let REFUSED: unknown = null

// The document while it is still being BUILT, which is what a read taken during a resolve is
// answered from — see the note on `knobOf`. Null except inside one.
let RESOLVING_DOCUMENT: Config | null = null

const configLog = abideLog.channel('config')

/** What a refusal names. The registration rather than a file, because that is where the shape was. */
const NAMED = { address: 'onConfig' }

/**
 * The app's defaults, and the shape the assembled document has to match. Returns the way back off.
 *
 * `options.schema` is checked over the WHOLE document, after both layers merge: one door, like every
 * other gate in here, and the only one config has.
 *
 * A schema RETURNS what it accepts, so it normalises as well as refuses — which is the second half of
 * how a string out of the environment becomes the number the rest of an app expects. The first half
 * is free: a value is coerced to the TYPE OF THE DEFAULT it is overriding, so `POOL=30` over
 * `{ POOL: 20 }` is the number 30 with no shape declared at all. A schema is what decides the cases
 * that rule cannot — a field with no default, an enum, a shape.
 *
 * `defaults` may be `null` for an app that only wants the check. A document is left OPEN by every
 * shape abide derives, so a schema naming `STRIPE_KEY` and nothing else lets abide's own fields
 * through untouched — a config schema describes what the APP needs, not the environment table.
 *
 * Registering DROPS whatever was resolved, so the order of an app's own imports cannot decide
 * whether its defaults were seen: a hook registered after something already asked still applies to
 * the next ask.
 *
 * Called ONCE. There is one account of what an app's defaults are, so a second registration REPLACES
 * the first — its schema with it — and says so rather than doing it quietly. Silent was the wrong
 * shape here even though `onHealth` and `onStart` are silent about the same thing: those replace one
 * FUNCTION, and this replaces a whole document's worth of defaults, so the mistake is two modules
 * that did not know about each other and the symptom is a field that is suddenly its floor. A warning
 * rather than a throw, because taking the disposer and registering again is legitimate — which is
 * exactly what `off()` first says, and why that path is silent.
 */
export function onConfig<Extra extends object = Record<never, never>>(
    defaults: ConfigDefaults | null,
    options?: ConfigOptions<Config & Extra>,
): () => void {
    const registration: Registration = {
        defaults,
        // Built ONCE here rather than per resolve, the same place a transport declaration builds its
        // own — and `null` when nothing was declared, which is the whole cost of this to an app that
        // declares no shape.
        gate: gate(options?.schema as Schema<unknown> | undefined, 'this process', 500, NAMED),
    }
    if (REGISTERED !== null) {
        configLog.warning(
            'onConfig was called twice — the second registration replaces the first, schema included. Merge them into one hook, or take the disposer the first returned before registering again.',
        )
    }
    REGISTERED = registration
    config.invalidate()
    return () => {
        if (REGISTERED !== registration) return
        REGISTERED = null
        config.invalidate()
    }
}

export const config: Configured = (<Extra extends object>(): Config & Extra => {
    if (RESOLVED === null) {
        if (REFUSED !== null) throw REFUSED
        try {
            RESOLVED = resolve()
        } catch (refusal) {
            REFUSED = refusal
            throw refusal
        } finally {
            RESOLVING_DOCUMENT = null
        }
    }
    return RESOLVED as Config & Extra
}) as Configured

config.invalidate = (): void => {
    RESOLVED = null
    REFUSED = null
}

/**
 * One knob as the path that USES it reads it — the `$server` half of `$shared`'s `knob()`, and what
 * that seam is registered with below.
 *
 * NOT a shorthand for `config()[field]`, and the three differences are the reason it exists.
 *
 * It takes no FALLBACK: every `Env` field is filled in by the floor, so the document always has one,
 * and a call site passing its own would be the second environment read this file's header says must
 * not exist — a knob named twice, one typo away from never applying.
 *
 * It answers DURING a resolve, from the layer already assembled. An `onConfig` hook that logs reaches
 * the sink gate, which asks this; `config()` would find `RESOLVED` still null and resolve again,
 * running the hook a second time and recursing until the stack goes.
 *
 * And it does not THROW. A refused config answers its floor, because three of these are read by the
 * logger — the report of a config that cannot be worked out must not be the thing that failure kills.
 * `config()` still throws, which is where `boot` reads it and where an operator gets told.
 */
export function knobOf<K extends keyof Env>(field: K): Env[K] {
    const building = RESOLVING_DOCUMENT
    if (building !== null) return building[field] as Env[K]
    // Ahead of the call rather than only in the `catch`, so a refused process does not pay a throw
    // per knob on paths that run per request and per log line.
    if (REFUSED !== null) return FLOOR[field]
    try {
        return config()[field] as Env[K]
    } catch {
        return FLOOR[field]
    }
}

// The `$shared` half of the same question, and the SAME function rather than a second copy of the
// three rules above. Registered on import, so loading `abide/server` is what gives the three ceilings
// a configured answer and a browser build keeps its floor.
useConfigSource(knobOf as (field: string) => unknown)

/**
 * The two layers, assembled.
 *
 * The FLOOR and what was DECLARED are kept apart, and that separation is the whole mechanism: the
 * environment the hook SEES is the two of them merged — complete, so it can branch on `NODE_ENV`
 * without a null check of its own — while the layer that WINS over the hook is only what was actually
 * named. Merged into one first, a floor would out-rank every default an app wrote, and `PORT` could
 * never be defaulted at all because 3000 is always there.
 */
function resolve(): Config {
    // The floor answers a read taken before anything is assembled — `declaredEnv` is only `env()`
    // calls, so nothing in that window logs, but a knob has to have an answer for it either way.
    // Both writes are here so the "non-null exactly while resolving" invariant is one function's.
    RESOLVING_DOCUMENT = FLOOR as Config
    const declared = declaredEnv()
    const assembled = { ...FLOOR, ...declared } as Config
    RESOLVING_DOCUMENT = assembled
    const registered = REGISTERED
    if (registered === null) return assembled
    // `undefined` from a registration that only declared a shape fails the object test below, which
    // is what folds the no-hook case into this one path.
    const defaults = registered.defaults?.(assembled)
    // Anything else is nothing to merge. Not a warning like `onHealth`'s, because there is nothing to
    // salvage here and nothing an operator could act on: a hook that returned a number said nothing.
    if (defaults !== null && typeof defaults === 'object' && !Array.isArray(defaults)) {
        // Onto `assembled` rather than a second spread of the floor: it already IS floor-then-
        // declared, so laying the hook's layer over it and re-applying `declared` puts the app under
        // the operator with one object rather than two.
        Object.assign(assembled, defaults, declared)
        overridden(assembled, defaults as Record<string, unknown>)
    }
    return checked(assembled, registered.gate)
}

/**
 * The app's OWN fields, put under the environment the same way abide's are.
 *
 * This is what makes the rule one rule. `declaredEnv` can only speak for variables abide knows the
 * type of; a field abide has never heard of has no entry there, so without this pass an app's default
 * would be the last word on it — and `STRIPE_KEY=sk_live` would be a variable an operator set and
 * nothing read.
 *
 * Coerced to the type of the DEFAULT, because that is the only thing here that says what the field
 * is: an environment carries strings, and `{ POOL: 20 }` is the app saying this one is a number. A
 * value that cannot be read as one keeps the default rather than poisoning the document with `NaN`,
 * which is the same rule `envNumber` follows for every knob abide owns. A declared shape runs after
 * this and is what decides anything richer.
 */
function overridden(document: Config, defaults: Record<string, unknown>): void {
    for (const field in defaults) {
        // Abide's own are already under `declared`, typed by the reader that knows the variable.
        if (field in FLOOR) continue
        const raw = env(field)
        if (raw === undefined) continue
        document[field] = coerced(raw, defaults[field])
    }
}

/** `''` is not a spelling of false — `env` already reads an empty variable as unset. */
const FALSE_SPELLINGS = new Set(['0', 'false', 'no', 'off'])

function coerced(raw: string, exemplar: unknown): unknown {
    if (typeof exemplar === 'number') {
        const parsed = Number(raw)
        return Number.isFinite(parsed) ? parsed : exemplar
    }
    if (typeof exemplar === 'boolean') return !FALSE_SPELLINGS.has(raw.toLowerCase())
    return raw
}

/**
 * The declared shape over the assembled document — the last thing that happens, because a shape that
 * ran before the merge would be checking a layer rather than the answer.
 *
 * A Standard Schema may validate ASYNCHRONOUSLY, and this is the one place in abide that cannot wait
 * for one: `config()` is synchronous so that reading a field is never a read somebody has to await.
 * Refused by name rather than by silently taking the promise as a value, and the pending validation
 * is caught so an app that shipped one does not also get an unhandled rejection on top of the message
 * telling it what to do instead.
 */
function checked(document: Config, gated: Gate<unknown> | null): Config {
    if (gated === null) return document
    const answered = gated(document)
    if (!isThenable(answered)) return answered as Config
    void (answered as Promise<unknown>).catch(() => undefined)
    throw new Error(
        'abide: onConfig’s schema validated asynchronously, and config is resolved synchronously so that reading a field is never a read to await. Do the waiting inside `onStart` and register what it settled to before calling `start()`.',
    )
}

/** What abide means by each variable when nobody declared one. Never mutated — always spread from. */
const FLOOR: Env = {
    PORT: DEFAULT_PORT,
    NODE_ENV: null,
    DEBUG: null,
    NO_COLOR: null,
    FORCE_COLOR: null,
    APP_URL: null,
    ABIDE_APP_NAME: null,
    ABIDE_APP_URL: null,
    ABIDE_APP_TOKEN: null,
    ABIDE_DATA_DIR: null,
    ABIDE_LOGS: false,
    ABIDE_LOG_BUFFER: 500,
    ABIDE_LOG_FORMAT: null,
    ABIDE_IDENTITY_SECRET: null,
    ABIDE_IDENTITY_TTL: 30 * 24 * 60 * 60 * 1000,
    ABIDE_RPC_TIMEOUT: 300_000,
    ABIDE_MAX_REQUEST_BODY_SIZE: NO_LIMIT,
    ABIDE_MAX_GLOBAL_CACHE_SIZE: NO_LIMIT,
    ABIDE_MAX_STREAM_BUFFER_SIZE: NO_LIMIT,
    ABIDE_SSR_STREAM_BUDGET: NO_LIMIT,
}

/**
 * Only what the environment actually NAMED — the layer nothing an app writes may overrule.
 *
 * Walked off `FLOOR`, which already carries every field's name AND its type, so the table is written
 * once rather than a second and third time here. A per-field list would be the place a knob added to
 * `Env` gets forgotten, and the symptom of forgetting is an operator's variable read by nothing.
 *
 * Only what was NAMED, because `envNumber` cannot say the difference between a fallback and a
 * declaration and that difference is what decides whether an app's default applies.
 */
function declaredEnv(): Partial<Env> {
    const declared: Record<string, unknown> = {}
    for (const field in FLOOR) {
        const raw = env(field)
        if (raw === undefined) continue
        const floor = FLOOR[field as keyof Env]
        // Read as the type of the floor — the same rule `overridden` applies to an app's own fields,
        // where the default is the only thing that says what a field IS. `envNumber` rather than
        // `coerced` because every number abide owns is positive, so `PORT=nonsense` keeps 3000 rather
        // than becoming `NaN` or inventing a knob nobody has.
        if (typeof floor === 'number') declared[field] = envNumber(field, floor)
        // Presence IS the declaration. `env` already reads an empty variable as unset, which is the
        // whole of how the one flag here is turned off.
        else if (typeof floor === 'boolean') declared[field] = true
        else declared[field] = raw
    }
    // The one enum, checked after the walk rather than by a type that has to exclude it from the text
    // case: a spelling that is neither leaves the field UNDECLARED, so the floor's `null` stands and
    // the shape follows the lane.
    const format = declared.ABIDE_LOG_FORMAT
    if (format !== 'tsv' && format !== 'json') delete declared.ABIDE_LOG_FORMAT
    return declared as Partial<Env>
}
