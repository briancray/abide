const SPECIAL = /[&<>"]/g

const ENTITIES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
}

/** Text as HTML that reads as that text, in an element or a double-quoted attribute. */
export function escapeHtml(text: string): string {
    return text.replace(SPECIAL, (special) => ENTITIES[special] as string)
}
