import { attributeText } from '#shared/attributeText.ts'
import { WORK } from '#shared/WORK.ts'

/**
 * Writes, or removes, a bound attribute, skipping an unchanged write.
 *
 * 32.3 — what an attribute binding writes, and the client half the server never had: `emitComponent`
 * writes the value standing at render and, without this, nothing writes it again. A page whose
 * `{count}` moved while its `class={tone}` did not is the shape that was shipping, and no
 * correctness test of the first slot could see the second.
 *
 * NOT ESCAPED, for `escapeless`'s reason: the server concatenates into markup a browser parses, and
 * `setAttribute` is not a parse. Escaping here would put `&amp;` in a `title` where the server put
 * `&`.
 *
 * 32.38 — PRESENT, ABSENT OR TEXT is `attributeText`'s answer, the one the server's markup took, so
 * `disabled={busy}` going false removes the attribute the server wrote, and 32.21's scheme check is
 * the same call on both sides.
 *
 * THE COMPARE IS THE REST OF THE POINT. `getAttribute` reads a value the element already holds —
 * it is not a layout read and forces nothing — and a binding re-run by a value that landed on the
 * same string is the common case rather than the rare one, so the branch is cheaper than the
 * mutation it skips.
 */
export function setAttribute(
    element: Element,
    name: string,
    value: unknown,
): void {
    WORK.bindingRuns += 1
    const next = attributeText(name, value)
    if (next === null) {
        if (element.hasAttribute(name)) element.removeAttribute(name)
        return
    }
    if (element.getAttribute(name) !== next) element.setAttribute(name, next)
}
