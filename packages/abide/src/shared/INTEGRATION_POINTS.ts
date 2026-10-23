/**
 * The SVG and MathML elements whose children the HTML parser reads as HTML again — the
 * integration points — less `annotation-xml`, which is one only by the encoding it declares.
 *
 * A leaf, because the client's parse and build read it (`namespaceUnder`) and the compiler reads
 * it to know a built element below one is HTML's, whatever its parent's namespace.
 */
export const INTEGRATION_POINTS: ReadonlySet<string> = new Set([
    'foreignObject',
    'desc',
    'title',
    'mi',
    'mo',
    'mn',
    'ms',
    'mtext',
])

/** HTML's namespace: what the parser gives an element outside SVG and MathML, and below an integration point. */
export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'
