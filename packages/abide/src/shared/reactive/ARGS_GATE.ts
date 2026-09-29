/**
 * Where a `Keyed` keeps the `args` schema it was declared with, for a transport to read back.
 *
 * 19.8's coercion needs the JSON Schema it declares. A leaf for `KEYED_BRAND`'s reason: `scoped.ts`
 * copies it onto the forwarder a server builds, and cannot import `Keyed.ts`.
 */
export const ARGS_GATE: unique symbol = Symbol.for('abide.argsGate')
