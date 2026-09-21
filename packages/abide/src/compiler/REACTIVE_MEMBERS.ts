// The members the `Reactive` type declares, taken from REGISTRY's `Reactive` section. A constants
// leaf, with no imports of its own.
//
// 31.5 and 31.6 turn on this list: a property access on a name bound to a `Reactive` reaches the
// VALUE — `regions.join(', ')` is the array's `join` — EXCEPT for a member declared on the
// `Reactive` itself, which reaches that. Without the list every `n.foo` reads as the API and the
// value's own members are unreachable, which is what `regions.join is not a function` was.
//
// 31.9 wants the same question answered from the TYPE rather than from the name, which is a
// checker query this does not make yet. A value whose own type declares `set` or `peek` therefore
// resolves to the `Reactive`'s, and 31.13 asks for a warning naming exactly that case.
//
// WHICH IS WHY A NAME THE `Reactive` DOES NOT DECLARE MUST NOT BE HERE: it takes a member the
// value really has and resolves it to nothing. This list is exactly `MEMBERS` in
// `shared/reactive/Reactive.ts`, which already declares `then`, `catch` and `finally` — `value`
// and `args` are fields of `Cell` and of `ReactiveOptions`, neither of which the `Reactive`
// exposes.
export const REACTIVE_MEMBERS: ReadonlySet<string> = new Set([
    'busy',
    'error',
    'history',
    'invalidate',
    'isError',
    'patch',
    'peek',
    'publish',
    'ready',
    'refresh',
    'set',
    'watch',
    // A `Reactive` is thenable (1.4), and `catch`/`finally` derive from `then` (1.5).
    'then',
    'catch',
    'finally',
])
