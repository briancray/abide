import { textOf } from '#shared/Raw.ts'
import { WORK } from '#shared/WORK.ts'

// 32.3 — what an attribute binding writes, and the client half the server never had: `emitComponent`
// writes the value standing at render and, without this, nothing writes it again. A page whose
// `{count}` moved while its `class={tone}` did not is the shape that was shipping, and no
// correctness test of the first slot could see the second.
//
// NOT ESCAPED, for `escapeless`'s reason: the server concatenates into markup a browser parses, and
// `setAttribute` is not a parse. Escaping here would put `&amp;` in a `title` where the server put
// `&`. `textOf` rather than `String` so a `Raw` is its html on this side too, which is the one
// stringify both lanes share.
//
// THE COMPARE IS THE REST OF THE POINT. `getAttribute` reads a value the element already holds —
// it is not a layout read and forces nothing — and a binding re-run by a value that landed on the
// same string is the common case rather than the rare one, so the branch is cheaper than the
// mutation it skips.
//
// AN ABSENT VALUE WRITES THE EMPTY STRING rather than removing the attribute, because that is what
// the server wrote for it: `escapeAttribute(undefined)` is '', so the document already carries
// `name=""` and removing it here would be the client disagreeing with the markup it is hydrating.
// A boolean attribute wanting the other answer is 32.7, which is not built on either side.
export function setAttribute(
    element: Element,
    name: string,
    value: unknown,
): void {
    WORK.bindingRuns += 1
    const next = textOf(value)
    if (element.getAttribute(name) !== next) element.setAttribute(name, next)
}
