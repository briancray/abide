/**
 * The bodies a handler was declared over, which `createKeyed` holds to 16.109: a run answering a
 * `Reactive` refuses rather than adopting it. A set rather than an option, so the mark reaches the
 * entry without threading through every builder between `handlerValue` and `createKeyed`.
 */
export const SERVED_BODIES = new WeakSet<object>()

export const SERVES_NO_REACTIVE =
    'abide: a handler serves a function or a memo, not a reactive value. Serve the value a memo keeps, and write it with handler.set or handler.patch. RULEBOOK 16.109.'
