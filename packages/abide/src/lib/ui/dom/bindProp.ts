/*
The parent half of a component `bind:prop={target}`: annotates the prop's value
thunk with a `set` write-back channel, so the same `() => value` entry every prop
compiles to ALSO carries a setter. A read-only consumer calls the thunk (`$props[key]?.()`)
and gets the value exactly as for a plain prop — the `set` simply rides along, invisible
to code that doesn't look for it (`restProps`/`mergeProps`/`spreadProps` pass the thunk
through untouched). The child upgrades the prop to a writable cell (`bindableProp`) only
when it writes or forwards it, and reaches this setter through `.set`.

`read`/`write` are the caller's lowered bind accessors — an lvalue target reads as
itself and writes by assignment, a `{ get, set }` accessor reads via `get()` and writes
via `set(next)` — so a component bind accepts the same targets an element bind does.
*/
// @documentation plumbing
export function bindProp<T>(
    read: () => T,
    write: (next: T) => void,
): (() => T) & { set: (next: T) => void } {
    const thunk = read as (() => T) & { set: (next: T) => void }
    thunk.set = write
    return thunk
}
