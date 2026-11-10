// The array methods that change the array they are called on. A constants leaf, read on both sides:
// `recordWrites` intercepts each to keep it as the JSON Patch it makes rather than the index writes it
// does underneath, and 31.9 lifts a call of one on a name bound to a `Reactive` to a write through the
// receiver's path where the receiver's TYPE is an array (`liftedMutators` in `readsIn`).
export const RESHAPING: ReadonlySet<string> = new Set([
    'push',
    'pop',
    'shift',
    'unshift',
    'splice',
    'sort',
    'reverse',
    'fill',
    'copyWithin',
])
