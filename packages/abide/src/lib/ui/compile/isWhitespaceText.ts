import type { TemplateNode } from './types/TemplateNode.ts'

/* A text node that is purely whitespace (no interpolation, only blank static
   parts). Both back-ends drop it, so it neither contributes markup nor breaks a
   static clone run — it stays transparent so `<a/>\n<b/>` still coalesces. */
export function isWhitespaceText(node: TemplateNode): boolean {
    return (
        node.kind === 'text' &&
        node.parts.every((part) => part.kind === 'static' && part.value.trim() === '')
    )
}
