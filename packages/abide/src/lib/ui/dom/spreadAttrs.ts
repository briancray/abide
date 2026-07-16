import { effect } from '../effect.ts'
import { SuspenseSignal } from '../runtime/SuspenseSignal.ts'
import { attr } from './attr.ts'
import { on } from './on.ts'

/*
Spreads an object's keys onto a native element — the `<div {...rest}>` runtime. `source`
is a thunk over the spread expression; its keys are enumerated ONCE (so the attribute set
is fixed at build, not reactively added/removed), but each value stays live: an `on<event>`
key holding a function attaches as that event listener (mirroring `onclick={…}` on an
element), and every other key binds as a reactive attribute (`attr`, re-reading the source
per change, with the same present/absent semantics — `false`/`null`/`undefined` removes it,
`true` sets it bare). A function under a non-`on` key is skipped (no attribute for it). A key
in `exclude` is skipped — the element names it explicitly, and an explicit attribute wins
over a spread key (the same set SSR's `$spread` skips, keeping the two sides congruent).
*/
// @documentation plumbing
export function spreadAttrs(
    element: Element,
    source: () => Record<string, unknown>,
    exclude: string[] = [],
): void {
    const skip = new Set(exclude)
    let object: Record<string, unknown>
    try {
        object = source()
    } catch (signal) {
        /* A spread over a PENDING blocking `await` read throws a `SuspenseSignal` here (ADR-0042):
           its keys can't be enumerated yet. Binding the empty object now would create no `attr`/`on`
           effects, so the attributes would never appear after the cell resolves — instead defer the
           enumeration into a one-shot effect that re-runs on settle (the read tracked its cell). The
           effect is pinned to this build's scope, so the `attr` binds it creates own their lifetime
           correctly; a `spread` flag makes the enumeration fire exactly once (later value changes
           re-read per key via `attr`, never re-enumerate). */
        if (!(signal instanceof SuspenseSignal)) {
            throw signal
        }
        let spread = false
        effect(() => {
            let resolved: Record<string, unknown>
            try {
                resolved = source()
            } catch (retry) {
                if (!(retry instanceof SuspenseSignal)) {
                    throw retry
                }
                return
            }
            if (spread) {
                return
            }
            spread = true
            bindKeys(element, source, resolved, skip)
        })
        return
    }
    bindKeys(element, source, object, skip)
}

/* Binds each own key of `object` onto `element`: an `on<event>` function attaches as a listener,
   any other non-function value binds as a reactive attribute re-reading `source()[key]` per change.
   A key in `skip` is left to its explicit binding. */
function bindKeys(
    element: Element,
    source: () => Record<string, unknown>,
    object: Record<string, unknown>,
    skip: Set<string>,
): void {
    for (const key in object) {
        if (skip.has(key)) {
            continue
        }
        /* Reading the value can itself throw a `SuspenseSignal`: when `source()` is a
           restProps proxy (the `<Button {...rest}>` case), its `get` invokes the underlying
           prop thunk, so a key whose expression reads a still-pending blocking `await` suspends
           HERE — after the `source()` enumeration guard already passed. Classify it as an
           attribute; `attr`'s own effect swallows the suspend and fills the value in on settle.
           An event handler never suspends — its thunk returns a function without reading a cell. */
        let value: unknown
        try {
            value = object[key]
        } catch (signal) {
            if (!(signal instanceof SuspenseSignal)) {
                throw signal
            }
            attr(element, key, () => source()[key])
            continue
        }
        if (key.startsWith('on') && typeof value === 'function') {
            on(element, key.slice(2), value as EventListener)
        } else if (typeof value !== 'function') {
            attr(element, key, () => source()[key])
        }
    }
}
