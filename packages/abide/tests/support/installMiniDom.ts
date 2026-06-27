/*
A minimal, dependency-free DOM for headless tests and benches of the ui/dom
render layer (jsdom is an unusable version-mismatched transitive here, and adding
a DOM dependency for a handful of node operations isn't worth it). Implements
only what the bindings touch: element/text/comment creation, child insertion/
removal/reordering, attributes, textContent aggregation, events, `innerHTML`
parsing, and HTML serialization. Installs `document`, `Event`, `Node`,
`serializeMiniDom`, and `parseHTML` on globalThis and returns a reset.
*/
export function installMiniDom(): () => void {
    const HTML_NS = 'http://www.w3.org/1999/xhtml'
    const SVG_NS = 'http://www.w3.org/2000/svg'
    const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'
    /* The namespace an element gets given the namespace it is parsed in: `<svg>`/`<math>`
       enter their foreign namespace; everything else stays in the current one — mirroring
       the HTML parser's foreign-content rules. */
    const elementNamespace = (tagName: string, current: string): string => {
        if (tagName === 'svg') {
            return SVG_NS
        }
        if (tagName === 'math') {
            return MATHML_NS
        }
        return current
    }
    /* The namespace this element's children parse in. `<foreignObject>` is SVG's re-entry
       point back into HTML, so its children revert despite its own SVG namespace. */
    const childNamespace = (tagName: string, own: string): string =>
        own === SVG_NS && tagName === 'foreignObject' ? HTML_NS : own
    const VOID = new Set([
        'area',
        'base',
        'br',
        'col',
        'embed',
        'hr',
        'img',
        'input',
        'link',
        'meta',
        'param',
        'source',
        'track',
        'wbr',
    ])
    const ESCAPES: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }
    const escapeHtml = (value: string): string =>
        value.replace(/[&<>"']/g, (character) => ESCAPES[character] as string)
    const unescapeHtml = (value: string): string =>
        value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&')

    class MiniNode {
        childNodes: MiniNode[] = []
        parentNode: MiniNode | undefined = undefined
        /* Forward sibling pointer, maintained O(1) by `place`/`removeChild`, so
           `nextSibling` is O(1) like a real DOM — not an `indexOf` scan of the parent's
           children. The reconcile reads `nextSibling` once per row; the array scan made it
           O(n²) per pass, swamping the benches with a harness artifact the browser never pays. */
        nextSib: MiniNode | null = null

        /* The core single-node placement. Fragment spreads route here directly (not
           back through the public methods) so a `insertBefore(fragment)` is one public
           call — matching the native DOM, where moving a fragment's children doesn't
           re-enter insertBefore (a spy counting moves sees one call, not N). */
        private place(node: MiniNode, reference: MiniNode | null): void {
            /* A non-null reference that isn't a child throws `NotFoundError` in a real DOM
               (strict in WebKit) — replicate it so a stale insertion ref (e.g. a node a
               control-flow block already removed) surfaces here, not only in the browser. */
            const index = reference === null ? -1 : this.childNodes.indexOf(reference)
            if (reference !== null && index === -1) {
                throw new Error('NotFoundError: insertBefore reference node is not a child')
            }
            node.remove()
            node.parentNode = this
            if (index === -1) {
                const previous = this.childNodes[this.childNodes.length - 1]
                this.childNodes.push(node)
                node.nextSib = null
                if (previous !== undefined) {
                    previous.nextSib = node
                }
            } else {
                /* `node.remove()` above may have shifted the reference's index when both
                   share this parent — recompute against the current array. */
                const at = this.childNodes.indexOf(reference as MiniNode)
                this.childNodes.splice(at, 0, node)
                node.nextSib = reference
                const previous = this.childNodes[at - 1]
                if (previous !== undefined) {
                    previous.nextSib = node
                }
            }
        }

        appendChild(child: MiniNode): MiniNode {
            /* A fragment inserts its children and is left empty (real DocumentFragment). */
            if (child instanceof MiniFragment) {
                for (const node of [...child.childNodes]) {
                    this.place(node, null)
                }
                return child
            }
            this.place(child, null)
            return child
        }

        insertBefore(node: MiniNode, reference: MiniNode | null): MiniNode {
            if (node instanceof MiniFragment) {
                for (const child of [...node.childNodes]) {
                    this.place(child, reference)
                }
                return node
            }
            this.place(node, reference)
            return node
        }

        removeChild(child: MiniNode): MiniNode {
            const index = this.childNodes.indexOf(child)
            if (index !== -1) {
                this.childNodes.splice(index, 1)
                /* Relink the gap: the node now at `index-1` (unshifted by the splice)
                   inherits the removed child's forward pointer. */
                const previous = this.childNodes[index - 1]
                if (previous !== undefined) {
                    previous.nextSib = child.nextSib
                }
                child.nextSib = null
                child.parentNode = undefined
            }
            return child
        }

        remove(): void {
            this.parentNode?.removeChild(this)
        }

        get firstChild(): MiniNode | null {
            return this.childNodes[0] ?? null
        }

        get nextSibling(): MiniNode | null {
            return this.parentNode === undefined ? null : this.nextSib
        }

        get textContent(): string {
            return this.childNodes.map((child) => child.textContent).join('')
        }

        set textContent(value: string) {
            for (const child of this.childNodes) {
                child.parentNode = undefined
                child.nextSib = null
            }
            this.childNodes = value === '' ? [] : [new MiniText(value)]
        }

        /* Deep/shallow clone, mirroring `Node.cloneNode` — what `cloneStatic` clones a
           parsed template's children with. Overridden per subclass to carry their data. */
        cloneNode(deep = false): MiniNode {
            const clone = new MiniNode()
            if (deep) {
                for (const child of this.childNodes) {
                    clone.appendChild(child.cloneNode(true))
                }
            }
            return clone
        }
    }

    class MiniText extends MiniNode {
        data: string
        constructor(data: string) {
            super()
            this.data = data
        }
        get textContent(): string {
            return this.data
        }
        /* Splits at `offset`: this node keeps the first part, a new sibling holds
           the rest (used by hydration to separate merged SSR text). */
        splitText(offset: number): MiniText {
            const rest = new MiniText(this.data.slice(offset))
            this.data = this.data.slice(0, offset)
            this.parentNode?.insertBefore(rest, this.nextSibling)
            return rest
        }
        cloneNode(): MiniNode {
            return new MiniText(this.data)
        }
    }

    /* A comment node — used as a streaming/hydration boundary marker. */
    class MiniComment extends MiniNode {
        data: string
        constructor(data: string) {
            super()
            this.data = data
        }
        get textContent(): string {
            return ''
        }
        cloneNode(): MiniNode {
            return new MiniComment(this.data)
        }
    }

    /* A DocumentFragment — a holder whose children move into the target on insert. */
    class MiniFragment extends MiniNode {}

    class MiniElement extends MiniNode {
        tagName: string
        /* The element's namespace, mirroring the real DOM: `createElement` is HTML,
           `createElementNS` is the given one, and `innerHTML` propagates the holder's
           namespace to parsed descendants — so a `<path>` parsed under an SVG holder
           reports the SVG namespace (the property `parseRawNodes` keys off). */
        namespaceURI: string
        attributes = new Map<string, string>()
        listeners = new Map<string, Set<EventListener>>()
        /* A `<template>` parses its `innerHTML` into `.content` (a holder node), not
           its own children — matching the real DocumentFragment. `cloneStatic` clones
           `content`'s children. */
        content: MiniNode | undefined = undefined
        constructor(tagName: string, namespaceURI = HTML_NS) {
            super()
            this.tagName = tagName
            this.namespaceURI = namespaceURI
            if (tagName === 'template') {
                this.content = new MiniNode()
            }
        }
        /* The DOM uppercases element node names (HTML namespace); mirror it so callers
           can match against `nodeName === 'SCRIPT'` as they would in a browser. */
        get nodeName(): string {
            return this.tagName.toUpperCase()
        }
        /* The lowercased tag, as the real DOM exposes it — `inheritedNamespace` reads it
           to spot `<foreignObject>` (SVG's re-entry into HTML). */
        get localName(): string {
            return this.tagName
        }
        get children(): MiniElement[] {
            return this.childNodes.filter(
                (child): child is MiniElement => child instanceof MiniElement,
            )
        }
        setAttribute(name: string, value: string): void {
            this.attributes.set(name, value)
        }
        getAttribute(name: string): string | null {
            return this.attributes.get(name) ?? null
        }
        removeAttribute(name: string): void {
            this.attributes.delete(name)
        }
        hasAttribute(name: string): boolean {
            return this.attributes.has(name)
        }
        addEventListener(type: string, handler: EventListener): void {
            const set = this.listeners.get(type) ?? new Set()
            set.add(handler)
            this.listeners.set(type, set)
        }
        removeEventListener(type: string, handler: EventListener): void {
            this.listeners.get(type)?.delete(handler)
        }
        dispatchEvent(event: { type: string }): boolean {
            for (const handler of this.listeners.get(event.type) ?? []) {
                handler(event as Event)
            }
            return true
        }
        set innerHTML(html: string) {
            /* A template parses into its content holder, every other element into
               itself. */
            const target = this.content ?? this
            for (const child of target.childNodes) {
                child.parentNode = undefined
                child.nextSib = null
            }
            target.childNodes = []
            /* Parse in this element's child namespace so `svg.innerHTML = '<path/>'`
               namespaces the path — the property the foreign-content paths key off. A
               <template>'s content is an HTML context regardless of the template's own ns. */
            const context =
                this.content !== undefined
                    ? HTML_NS
                    : childNamespace(this.tagName, this.namespaceURI)
            for (const node of parseHTML(html, context)) {
                target.appendChild(node)
            }
        }
        cloneNode(deep = false): MiniNode {
            const clone = new MiniElement(this.tagName, this.namespaceURI)
            clone.attributes = new Map(this.attributes)
            if (this.content !== undefined) {
                clone.content = this.content.cloneNode(true)
            }
            if (deep) {
                for (const child of this.childNodes) {
                    clone.appendChild(child.cloneNode(true))
                }
            }
            return clone
        }
    }

    class MiniEvent {
        type: string
        constructor(type: string) {
            this.type = type
        }
    }

    /* Recursive-descent HTML parser → mini nodes (elements, text, comments). */
    function parseHTML(html: string, namespace = HTML_NS): MiniNode[] {
        let cursor = 0
        const parseNodes = (closeTag: string | undefined, currentNs: string): MiniNode[] => {
            const nodes: MiniNode[] = []
            while (cursor < html.length) {
                if (html.startsWith('<!--', cursor)) {
                    const end = html.indexOf('-->', cursor + 4)
                    const stop = end === -1 ? html.length : end
                    nodes.push(new MiniComment(html.slice(cursor + 4, stop)))
                    cursor = end === -1 ? html.length : end + 3
                } else if (html.startsWith('</', cursor)) {
                    const gt = html.indexOf('>', cursor)
                    const name = html.slice(cursor + 2, gt).trim()
                    cursor = gt + 1
                    if (closeTag !== undefined && name === closeTag) {
                        return nodes
                    }
                } else if (html.charAt(cursor) === '<') {
                    nodes.push(parseElement(currentNs))
                } else {
                    const next = html.indexOf('<', cursor)
                    const stop = next === -1 ? html.length : next
                    nodes.push(new MiniText(unescapeHtml(html.slice(cursor, stop))))
                    cursor = stop
                }
            }
            return nodes
        }
        const parseElement = (currentNs: string): MiniNode => {
            cursor += 1
            let name = ''
            while (cursor < html.length && !/[\s>/]/.test(html.charAt(cursor))) {
                name += html.charAt(cursor)
                cursor += 1
            }
            const ownNs = elementNamespace(name, currentNs)
            const element = new MiniElement(name, ownNs)
            while (
                cursor < html.length &&
                html.charAt(cursor) !== '>' &&
                html.charAt(cursor) !== '/'
            ) {
                while (/\s/.test(html.charAt(cursor))) {
                    cursor += 1
                }
                if (html.charAt(cursor) === '>' || html.charAt(cursor) === '/') {
                    break
                }
                let attrName = ''
                while (cursor < html.length && !/[\s=>/]/.test(html.charAt(cursor))) {
                    attrName += html.charAt(cursor)
                    cursor += 1
                }
                while (/\s/.test(html.charAt(cursor))) {
                    cursor += 1
                }
                if (html.charAt(cursor) === '=') {
                    cursor += 1
                    while (/\s/.test(html.charAt(cursor))) {
                        cursor += 1
                    }
                    const quote = html.charAt(cursor)
                    cursor += 1
                    let value = ''
                    while (cursor < html.length && html.charAt(cursor) !== quote) {
                        value += html.charAt(cursor)
                        cursor += 1
                    }
                    cursor += 1
                    element.setAttribute(attrName, unescapeHtml(value))
                } else if (attrName !== '') {
                    element.setAttribute(attrName, '')
                }
            }
            let selfClosing = false
            if (html.charAt(cursor) === '/') {
                selfClosing = true
                cursor += 1
            }
            if (html.charAt(cursor) === '>') {
                cursor += 1
            }
            if (!selfClosing && !VOID.has(name)) {
                for (const child of parseNodes(name, childNamespace(name, ownNs))) {
                    element.appendChild(child)
                }
            }
            return element
        }
        return parseNodes(undefined, namespace)
    }

    const serializeNode = (node: MiniNode): string => {
        if (node instanceof MiniComment) {
            return `<!--${node.data}-->`
        }
        if (!(node instanceof MiniElement)) {
            return escapeHtml((node as MiniText).data)
        }
        let html = `<${node.tagName}`
        for (const [name, value] of node.attributes) {
            html += ` ${name}="${escapeHtml(value)}"`
        }
        html += '>'
        if (VOID.has(node.tagName)) {
            return html
        }
        return `${html}${node.childNodes.map(serializeNode).join('')}</${node.tagName}>`
    }

    const document = {
        head: new MiniElement('head'),
        createElement: (tagName: string) => new MiniElement(tagName),
        createTextNode: (data: string) => new MiniText(data),
        createComment: (data: string) => new MiniComment(data),
        createDocumentFragment: () => new MiniFragment(),
    }

    const target = globalThis as Record<string, unknown>
    const previous = {
        document: target.document,
        Event: target.Event,
        Node: target.Node,
        serializeMiniDom: target.serializeMiniDom,
        parseHTML: target.parseHTML,
    }
    target.document = document
    target.Event = MiniEvent
    target.Node = MiniNode
    target.serializeMiniDom = (host: MiniNode) => host.childNodes.map(serializeNode).join('')
    target.parseHTML = parseHTML
    return () => {
        target.document = previous.document
        target.Event = previous.Event
        target.Node = previous.Node
        target.serializeMiniDom = previous.serializeMiniDom
        target.parseHTML = previous.parseHTML
    }
}
