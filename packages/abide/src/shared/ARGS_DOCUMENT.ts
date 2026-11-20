/**
 * The member of an `Rpc` holding the JSON Schema the build read for its args (19.9, 19.28): what a
 * `form` checks a submit against before the call is made. Stamped by `derivedArgs` on a server and by
 * a mutation's browser copy, so both sides hold one document.
 */
export const ARGS_DOCUMENT: unique symbol = Symbol.for('abide.argsDocument')
