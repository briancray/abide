/**
 * Where a `Keyed` keeps the defaults its body's parameter writes, for an `Rpc` to read back.
 *
 * 11.27, 11.29 — a transport applies them after it coerces and before it looks up a key. A leaf for
 * `ARGS_GATE`'s reason: `scoped.ts` copies it onto the forwarder a server builds.
 */
export const PARAMETER_DEFAULTS: unique symbol = Symbol.for(
    'abide.parameterDefaults',
)
