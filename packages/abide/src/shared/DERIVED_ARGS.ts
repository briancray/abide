/**
 * The member of an `Rpc` holding its args to the schema its annotation derives (19.9): stamped by the
 * module its handler is loaded through, on the server alone, and read by every call of it — in
 * process and over the wire alike (15.8).
 */
export const DERIVED_ARGS: unique symbol = Symbol.for('abide.derivedArgs')
