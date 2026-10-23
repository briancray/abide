import { attributeText } from '#shared/attributeText.ts'
import { FOREIGN_ATTRIBUTES } from '#shared/FOREIGN_ATTRIBUTES.ts'
import { HTML_NAMESPACE } from '#shared/INTEGRATION_POINTS.ts'
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
 * 32.37 — PRESENT, ABSENT OR TEXT is `attributeText`'s answer, the one the server's markup took, so
 * `disabled={busy}` going false removes the attribute the server wrote, and 32.20's scheme check is
 * the same call on both sides.
 *
 * THE COMPARE IS THE REST OF THE POINT. `getAttribute` reads a value the element already holds —
 * it is not a layout read and forces nothing — and a binding rerun by a value that landed on the
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
    const standing = element.getAttribute(name)
    if (standing === next) return
    if (standing === null) addAttribute(element, name, next)
    else element.setAttribute(name, next)
}

/**
 * Writes an attribute `element` does not hold yet, in the namespace the parser gives it there.
 *
 * 32.70 — an `xlink:href` on an SVG element is XLink's (`FOREIGN_ATTRIBUTES`), and one
 * `setAttribute` makes has none, so a `<use>` it names draws nothing. Only an attribute's CREATION
 * decides its namespace: `setAttribute` and `getAttribute` find a standing one by its qualified
 * name, whatever namespace it is in.
 */
export function addAttribute(
    element: Element,
    name: string,
    text: string,
): void {
    const space = FOREIGN_ATTRIBUTES.get(name)
    if (space === undefined || element.namespaceURI === HTML_NAMESPACE)
        element.setAttribute(name, text)
    else element.setAttributeNS(space, name, text)
}
