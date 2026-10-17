// MARKUP PARSED IN THE DOCUMENT `parent` BELONGS TO, not the global one. A page mounted into a second
// document (an example `<iframe>`) parsed its `{#if}` arms in the right one and its `{#for}` rows in
// the page's while the two were separate copies of this; one copy is one answer.
//
// ONE TEMPLATE PER DOCUMENT, reused: setting `innerHTML` replaces what the last parse left, and
// every caller moves those nodes out before it parses again.
const TEMPLATES = new WeakMap<Document, HTMLTemplateElement>()

const SVG = 'http://www.w3.org/2000/svg'
const MATHML = 'http://www.w3.org/1998/Math/MathML'

// The foreign elements whose children the parser reads as HTML again — the integration points —
// so markup going into one parses the way it would at the template's own top level.
const INTEGRATION_POINTS = new Set([
    'foreignObject',
    'desc',
    'title',
    'mi',
    'mo',
    'mn',
    'ms',
    'mtext',
])

/** Whether the parser reads `element`'s children as HTML again, though it is SVG or MathML. */
function isIntegrationPoint(element: Element): boolean {
    if (INTEGRATION_POINTS.has(element.localName)) return true
    // The HTML standard makes an `<annotation-xml>` one only by the encoding it declares.
    if (element.localName !== 'annotation-xml') return false
    const encoding = element.getAttribute('encoding')?.toLowerCase()
    return encoding === 'text/html' || encoding === 'application/xhtml+xml'
}

/**
 * Parses markup for `parent` — in its document, and in its NAMESPACE; the fragment is reused by the
 * next parse.
 *
 * IN THE PARENT'S NAMESPACE because the server's parser read the same bytes inside it: a template's
 * own children are HTML, so a `<circle>` parsed there alone is an `HTMLUnknownElement` that draws
 * nothing in the `<svg>` it lands in. Markup bound for an SVG or MathML parent is parsed inside an
 * `<svg>` or a `<math>` and the wrapper unwrapped — what the parser closes the wrapper on (a `<p>`
 * breaks out of foreign content) stays, beside what was inside it, in order.
 */
export function parseMarkup(parent: Node, markup: string): DocumentFragment {
    const document = parent.ownerDocument ?? (parent as Document)
    let template = TEMPLATES.get(document)
    if (template === undefined) {
        template = document.createElement('template')
        TEMPLATES.set(document, template)
    }
    const space = (parent as Element).namespaceURI
    const wrapper =
        (space !== SVG && space !== MATHML) ||
        isIntegrationPoint(parent as Element)
            ? undefined
            : space === SVG
              ? 'svg'
              : 'math'
    if (wrapper === undefined) {
        template.innerHTML = markup
        return template.content
    }
    template.innerHTML = `<${wrapper}>${markup}</${wrapper}>`
    const content = template.content
    const wrapped = content.firstChild as Element
    while (wrapped.firstChild !== null)
        content.insertBefore(wrapped.firstChild, wrapped)
    wrapped.remove()
    return content
}

/**
 * The parsed nodes as an array, which is what a row holds.
 *
 * Indexed rather than spread, so no iterator runs per row.
 */
export function markupNodes(parent: Node, markup: string): Node[] {
    const nodes: Node[] = []
    for (
        let node = parseMarkup(parent, markup).firstChild;
        node !== null;
        node = node.nextSibling
    )
        nodes.push(node)
    return nodes
}
