/**
 * The option key `declare` builds a mutation's value with: a sweep invalidates such a value rather
 * than reloading it, since a reload is the write sent again (13.16).
 */
export const MUTATION: unique symbol = Symbol('abide.mutation')
