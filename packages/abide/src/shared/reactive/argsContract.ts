// WHAT A KEYED VALUE'S ARGS ARE HELD TO, past the face an app is handed: the `args` schema it was
// declared with (19.7) and the defaults its body's parameter writes (11.29). A `Keyed` is where the
// contract starts; a server's forwarder and an `Rpc` are faces built over one, and each carries it
// through `contractOf` so a transport reads it off whichever face it was handed.
//
// DEFAULTS BEFORE THE KEY, IN ONE PLACE. 11.27: a call that left a member to the parameter and one
// that wrote it are one entry, so every reach, call and lookup takes the key through `normalised`
// — a caller that keyed the args as passed would file the same call twice, right in the value and
// wrong in the work.
//
// Imports no part of the core, so `scoped.ts` can carry the contract without reaching `Keyed.ts`.

import { putOwn } from '../putOwn.ts'
import type { Schema } from '../Schema.ts'
import { canonicalKey } from './canonicalKey.ts'
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
export function normalised<Args>(
    face: Pick<Gated<unknown>, typeof PARAMETER_DEFAULTS>,
    args: Args,
): Args {
    const defaults = face[PARAMETER_DEFAULTS]
    return defaults === null ? args : withDefaults(args, defaults)
}

/** The entry key a call with `args` is filed under: `normalised`, then 11.24's canonical form. */
export function keyOf(
    face: Pick<Gated<unknown>, typeof PARAMETER_DEFAULTS>,
    args: unknown,
): string {
    return canonicalKey(normalised(face, args))
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
