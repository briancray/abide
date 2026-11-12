// WHAT A KEYED VALUE'S ARGS ARE HELD TO, past the face an app is handed: the `args` schema it was
// declared with (19.7), the defaults its body's parameter writes (11.29), and — on a server's `Rpc`
// — the schema its annotation derives (19.9). A `Keyed` is where the contract starts; a server's
// forwarder and an `Rpc` are faces built over one, and each carries it through `contractOf` so a
// transport reads it off whichever face it was handed. What a server adds before a call off the wire
// reaches here — its text coerced, its path's parameters laid in — is `#server/argsContract.ts`.
//
// DEFAULTS BEFORE THE KEY, IN ONE PLACE. 11.27: a call that left a member to the parameter and one
// that wrote it are one entry, so every reach, call and lookup takes the key through `normalized`
// — a caller that keyed the args as passed would file the same call twice, right in the value and
// wrong in the work.
//
// Imports no part of the core, so `scoped.ts` can carry the contract without reaching `Keyed.ts`.

import { DERIVED_ARGS } from '../DERIVED_ARGS.ts'
import type { Issues } from '../Issues.ts'
import { putOwn } from '../putOwn.ts'
import { refuse } from '../refuse.ts'
import type { Schema } from '../Schema.ts'
import type { Defaults } from './parameterDefaults.ts'

export const ARGS_GATE: unique symbol = Symbol.for('abide.argsGate')
export const PARAMETER_DEFAULTS: unique symbol = Symbol.for(
    'abide.parameterDefaults',
)

/**
 * The contract a face carries: its `args` schema and its parameter defaults.
 *
 * Declared on what the framework builds rather than on `Keyed`, so no app type names it — and
 * declared rather than stamped, so a face that forgets to carry it does not compile.
 */
export type Gated<Args> = {
    [ARGS_GATE]: Schema<Args> | undefined
    [PARAMETER_DEFAULTS]: Defaults | null
}

/** The contract `face` carries, for a face built over it to carry — none where it is not keyed. */
export function contractOf(
    face: Partial<Gated<unknown>> | undefined,
): Gated<unknown> {
    return {
        [ARGS_GATE]: face?.[ARGS_GATE],
        [PARAMETER_DEFAULTS]: face?.[PARAMETER_DEFAULTS] ?? null,
    }
}

/** The `args` schema `face` carries, for a transport to coerce by (19.7). */
export function gateOf(
    face: Pick<Gated<unknown>, typeof ARGS_GATE>,
): Schema<unknown> | undefined {
    return face[ARGS_GATE]
}

/**
 * `args` with every member the face's parameter defaults filled where it is `undefined` (11.27).
 *
 * `args` itself where the face has no defaults or nothing was missing, so a caller that passed
 * every member allocates nothing and a second application is free.
 */
export function normalized<Args>(
    face: Pick<Gated<unknown>, typeof PARAMETER_DEFAULTS>,
    args: Args,
): Args {
    const defaults = face[PARAMETER_DEFAULTS]
    return defaults === null ? args : withDefaults(args, defaults)
}

/**
 * 19.9 — the issues an `Rpc`'s args leave against the schema its annotation derives, `null` where
 * they hold: `undefined` until the module its handler is loaded through stamps it (`derivedArgs`),
 * and so in a browser always. A function rather than the schema, so this seam never carries the
 * validator (19.13).
 */
export type HeldToAnnotation = {
    [DERIVED_ARGS]: ((args: unknown) => Issues<unknown> | null) | undefined
}

/**
 * The args a call of `face` is made with: `normalized`, then held to the schema its annotation
 * derives. Throws the `ValidationError` where they do not hold.
 *
 * 15.8, 19.9 — ONE STEP FOR EVERY WAY A HANDLER IS CALLED, in process and over the wire alike: a
 * type an in-process caller wrote holds nothing at run time (`as never`, a value off JSON), so it is
 * refused as the wire refuses it rather than handed to the body. 11.27 — the defaults first, so the
 * check reads what the handler will.
 */
export function acceptedArgs(
    face: Pick<Gated<unknown>, typeof PARAMETER_DEFAULTS> & HeldToAnnotation,
    given: unknown,
): unknown {
    const args = normalized(face, given)
    const issues = face[DERIVED_ARGS]?.(args) ?? null
    if (issues !== null) throw refuse.validation(issues)
    return args
}

/** The entry key a call with `args` is filed under: `normalized`, then 11.24's canonical form. */
export function keyOf(
    face: Pick<Gated<unknown>, typeof PARAMETER_DEFAULTS>,
    args: unknown,
): string {
    return canonicalKey(normalized(face, args))
}

// ABSENT ARGS ARE `{}`: a wire writes the two alike (an empty query), so read apart they are one
// call keyed two ways by the side it was made on — and a pattern with a default is a record by its
// own spelling.
function withDefaults<Args>(args: Args, defaults: Defaults): Args {
    if (args !== undefined && (typeof args !== 'object' || args === null))
        return args
    const given = (args ?? {}) as Record<string, unknown>
    const { names, values } = defaults
    let filled: Record<string, unknown> | null = null
    for (let index = 0; index < names.length; index += 1) {
        const name = names[index] as string
        if (given[name] !== undefined) continue
        filled ??= { ...given }
        const value = values[index]
        // A fresh copy of an object default, as the body's own evaluation makes one per call.
        putOwn(
            filled,
            name,
            typeof value === 'object' && value !== null
                ? structuredClone(value)
                : value,
        )
    }
    return (filled ?? given) as Args
}

/**
 * The entry key for an `Args` value: its canonical wire form, as a string.
 *
 * RULEBOOK 11.24: members sorted by name, `undefined` members dropped, `Date` written ISO.
 *
 * 11.26: the key is taken BEFORE any gate runs, because a browser holds no copy of the gate — a
 * key taken after normalizing is computed one way on a server and another in a browser, and every
 * handler with a normalizing schema would miss its seed buffer and re-issue the call on hydration.
 *
 * 11.64: WHAT THE WIRE FORM CANNOT WRITE IS REFUSED AT THE REACH. `JSON.stringify` does not fail
 * on any of it — a `Set`, a `Map` and a class instance each have no own enumerable keys and
 * canonicalize to `{}`, and a non-finite number is written `null` — so two different reaches
 * produced one key and 1.8 joined the second to the first's standing work. The value was right
 * for the first caller and wrong for every other one, with nothing to see.
 */
export function canonicalKey(args: unknown): string {
    if (args === undefined) return ''
    return JSON.stringify(canonical(args, []))
}

// THE PATH IS A STACK OF STEPS, joined only when a refusal names it. Built as a string per member
// it was a concatenation for every element and every nested key on every reach, for a message the
// success path never reads.
type Steps = (string | number)[]

function canonical(value: unknown, path: Steps): unknown {
    if (value === null) return value
    const kind = typeof value
    if (kind === 'number') {
        if (!Number.isFinite(value)) throw outside(String(value), path)
        return value
    }
    if (kind !== 'object') {
        if (kind === 'boolean' || kind === 'string') return value
        // `undefined` reaches here from an ARRAY element alone — a member is dropped above.
        throw outside(kind === 'undefined' ? 'undefined' : `a ${kind}`, path)
    }
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) {
        const out: unknown[] = []
        for (let index = 0; index < value.length; index += 1) {
            path.push(index)
            out.push(canonical(value[index], path))
            path.pop()
        }
        return out
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null)
        throw outside(named(value as object), path)
    const source = value as Record<string, unknown>
    const keys = Object.keys(source).sort()
    // AN ORDINARY OBJECT, AND `putOwn` FOR THE ONE KEY THAT NEEDS IT: `__proto__` is a SETTER on
    // `Object.prototype`, so `out[key] = …` for that key creates no own property and
    // `JSON.stringify` never sees it — `{id: 1, __proto__: {role: 'admin'}}` and `{id: 1}` then
    // canonicalize to one string, and 1.8 joins the second reach to the first's standing work.
    // `Object.create(null)` closed that too, and V8 builds it in DICTIONARY mode: the shipped key
    // took 49-56% of the time without it there, and a standing keyed reach 53%, where JSC reads
    // level to 110% (`abide/bench/sharedCases.ts`, two runs per engine).
    const out: Record<string, unknown> = {}
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index] as string
        const member = source[key]
        if (member === undefined) continue
        path.push(key)
        putOwn(out, key, canonical(member, path))
        path.pop()
    }
    return out
}

function named(value: object): string {
    const from = value.constructor as { name?: unknown } | undefined
    return typeof from?.name === 'string' && from.name !== ''
        ? `a ${from.name}`
        : 'a class instance'
}

function outside(what: string, steps: Steps): Error {
    let path = ''
    for (const step of steps)
        path +=
            typeof step === 'number'
                ? `[${step}]`
                : path === ''
                  ? step
                  : `.${step}`
    return new Error(
        `An Args key cannot carry ${what} at ${
            path === '' ? 'the arguments themselves' : `"${path}"`
        }: the canonical wire form writes it as another entry's key (RULEBOOK 11.64).`,
    )
}
