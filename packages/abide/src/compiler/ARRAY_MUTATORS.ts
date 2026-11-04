/**
 * The methods an array declares that change it in place.
 *
 * A constants leaf, with no imports of its own.
 *
 * 31.9 — a call of one on a name bound to a `Reactive` is lifted to a write through the receiver's
 * path only where the receiver's TYPE is an array (`liftedMutators` in `readsIn`): the name says
 * which method, the type says whose.
 */
export const ARRAY_MUTATORS: ReadonlySet<string> = new Set([
    'copyWithin',
    'fill',
    'pop',
    'push',
    'reverse',
    'shift',
    'sort',
    'splice',
    'unshift',
])
