/**
 * The mark that tells a `Keyed` from any other function.
 *
 * A leaf for the reason `REACTIVE_BRAND` is one. RULEBOOK 16.5: a transport reads which arm a
 * handler takes off this, and never off the shape — a `Keyed` is a function taking one argument,
 * and so is a plain handler.
 */
export const KEYED_BRAND: unique symbol = Symbol.for('abide.keyed')
