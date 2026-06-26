/* True for the source-scanner whitespace set (space, tab, CR, LF). Distinct from
   isWhitespaceText, which classifies template text nodes. */
export function isAsciiWhitespace(c: string | undefined): boolean {
    return c === ' ' || c === '\t' || c === '\n' || c === '\r'
}
