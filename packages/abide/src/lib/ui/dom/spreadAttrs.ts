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
    const object = source()
    for (const key in object) {
        if (skip.has(key)) {
            continue
        }
        const value = object[key]
        if (key.startsWith('on') && typeof value === 'function') {
            on(element, key.slice(2), value as EventListener)
        } else if (typeof value !== 'function') {
            attr(element, key, () => source()[key])
        }
    }
}
