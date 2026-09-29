// MARKUP PARSED IN THE DOCUMENT `near` BELONGS TO, not the global one. A page mounted into a second
// document (an example `<iframe>`) parsed its `{#if}` arms in the right one and its `{#for}` rows in
// the page's while the two were separate copies of this; one copy is one answer.
//
// ONE TEMPLATE PER DOCUMENT, reused: setting `innerHTML` replaces what the last parse left, and
// every caller moves those nodes out before it parses again.
const TEMPLATES = new WeakMap<Document, HTMLTemplateElement>()

/** Parses markup in `near`'s document; the fragment is reused by the next parse. */
export function parseMarkup(near: Node, markup: string): DocumentFragment {
    const document = near.ownerDocument ?? (near as Document)
    let template = TEMPLATES.get(document)
    if (template === undefined) {
        template = document.createElement('template')
        TEMPLATES.set(document, template)
    }
    template.innerHTML = markup
    return template.content
}

/**
 * The parsed nodes as an array, which is what a row holds.
 *
 * Indexed rather than spread, so no iterator runs per row.
 */
export function markupNodes(near: Node, markup: string): Node[] {
    const nodes: Node[] = []
    for (
        let node = parseMarkup(near, markup).firstChild;
        node !== null;
        node = node.nextSibling
    )
        nodes.push(node)
    return nodes
}
