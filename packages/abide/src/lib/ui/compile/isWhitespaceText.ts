import type { TemplateNode } from './types/TemplateNode.ts'

/* Only HTML-collapsible whitespace — space, tab, LF, CR, FF. Deliberately EXCLUDES
   U+00A0 (`&nbsp;`), which browsers neither collapse nor trim; `.trim()`/`\s` would
   wrongly count it, so a `<span>&nbsp;</span>` spacer would be dropped as blank. */
const COLLAPSIBLE_WHITESPACE = /[^ \t\n\r\f]/

/* A text node that is purely whitespace (no interpolation, only blank static
   parts). Both back-ends drop it, so it neither contributes markup nor breaks a
   static clone run — it stays transparent so `<a/>\n<b/>` still coalesces. A part
   holding a non-breaking space is renderable content, not blank. */
export function isWhitespaceText(node: TemplateNode): boolean {
    return (
        node.kind === 'text' &&
        node.parts.every(
            (part) => part.kind === 'static' && !COLLAPSIBLE_WHITESPACE.test(part.value),
        )
    )
}
