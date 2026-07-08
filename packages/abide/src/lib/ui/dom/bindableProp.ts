import { linked } from '../linked.ts'
import type { State } from '../runtime/types/State.ts'
import type { UiProps } from '../runtime/types/UiProps.ts'

/*
The child half of a two-way prop: the writable cell a component gets for a prop it
WRITES or forwards to another `bind:` target. A prop the child only reads stays a
read-only derive (unchanged, cheap); this upgrade is emitted only for the props the
compiler sees written, so the common case pays nothing.

Whether the prop is actually two-way is decided at construction from what the parent
passed:
  • Bound (`bind:prop` on the parent) — the value thunk carries a `set` (see `bindProp`),
    so the cell is a pass-through accessor: reads pull the parent's value (tracking its
    reactive source), writes go straight upstream. The parent's target is the single
    source of truth, so no local copy is kept.
  • Unbound (plain `prop={value}`, or the prop was never passed) — no setter exists, so
    the cell degrades to a local `linked` cell seeded from the parent value: it reseeds
    when the parent value changes and holds local writes in between. The component still
    works standalone; its writes just don't flow anywhere.

`fallback` supplies the destructure's `= default` when the prop is absent/undefined,
matching the read-only derive's `?? default`.
*/
// @documentation plumbing
export function bindableProp<T>(props: UiProps, key: string, fallback?: () => T): State<T> {
    const entry = (props as Record<string, unknown>)[key]
    const read = (): T => {
        const value = typeof entry === 'function' ? (entry as () => T)() : (entry as T)
        return (value === undefined ? fallback?.() : value) as T
    }
    const setter =
        typeof entry === 'function' ? (entry as { set?: (next: T) => void }).set : undefined
    if (setter !== undefined) {
        /* Bound: a pure pass-through to the parent's target — no local store. */
        return {
            get value(): T {
                return read()
            },
            set value(next: T) {
                setter(next)
            },
        }
    }
    /* Unbound: a local reseeding cell — writes echo locally, reseed on parent change. */
    return linked(read) as State<T>
}
