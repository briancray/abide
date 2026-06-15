/*
A minimal, dependency-free DOM for headless tests and benches of the ui/dom
render layer (jsdom is an unusable version-mismatched transitive here, and adding
a DOM dependency for a handful of node operations isn't worth it). Implements
only what the bindings touch: element/text creation, child insertion/removal/
reordering, attributes, textContent aggregation, and events. Installs `document`,
`Event`, and `Node` on globalThis and returns a reset for between tests.
*/
export function installMiniDom(): () => void {
    class MiniNode {
        childNodes: MiniNode[] = []
        parentNode: MiniNode | undefined = undefined

        appendChild(child: MiniNode): MiniNode {
            child.remove()
            child.parentNode = this
            this.childNodes.push(child)
            return child
        }

        insertBefore(node: MiniNode, reference: MiniNode | null): MiniNode {
            node.remove()
            node.parentNode = this
            const index = reference === null ? -1 : this.childNodes.indexOf(reference)
            if (index === -1) {
                this.childNodes.push(node)
            } else {
                this.childNodes.splice(index, 0, node)
            }
            return node
        }

        removeChild(child: MiniNode): MiniNode {
            const index = this.childNodes.indexOf(child)
            if (index !== -1) {
                this.childNodes.splice(index, 1)
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
            const siblings = this.parentNode?.childNodes
            if (siblings === undefined) {
                return null
            }
            return siblings[siblings.indexOf(this) + 1] ?? null
        }

        get textContent(): string {
            return this.childNodes.map((child) => child.textContent).join('')
        }

        set textContent(value: string) {
            for (const child of this.childNodes) {
                child.parentNode = undefined
            }
            this.childNodes = value === '' ? [] : [new MiniText(value)]
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
    }

    class MiniElement extends MiniNode {
        tagName: string
        attributes = new Map<string, string>()
        listeners = new Map<string, Set<EventListener>>()
        constructor(tagName: string) {
            super()
            this.tagName = tagName
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
    }

    class MiniEvent {
        type: string
        constructor(type: string) {
            this.type = type
        }
    }

    const document = {
        createElement: (tagName: string) => new MiniElement(tagName),
        createTextNode: (data: string) => new MiniText(data),
    }

    const target = globalThis as Record<string, unknown>
    const previous = {
        document: target.document,
        Event: target.Event,
        Node: target.Node,
        serializeMiniDom: target.serializeMiniDom,
    }
    target.document = document
    target.Event = MiniEvent
    target.Node = MiniNode
    /* Serializes a node's children to HTML — for comparing client render output
       against the SSR string. Escapes text and attribute values like the SSR
       back-end does, so a matching tree produces a byte-identical string. */
    const escape = (value: string): string =>
        value.replace(
            /[&<>"']/g,
            (character) =>
                ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
                    character
                ] as string,
        )
    const voidTags = new Set([
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
    const serializeNode = (node: MiniNode): string => {
        if (!(node instanceof MiniElement)) {
            return escape((node as MiniText).data)
        }
        let html = `<${node.tagName}`
        for (const [name, value] of node.attributes) {
            html += ` ${name}="${escape(value)}"`
        }
        html += '>'
        if (voidTags.has(node.tagName)) {
            return html
        }
        return `${html}${node.childNodes.map(serializeNode).join('')}</${node.tagName}>`
    }
    target.serializeMiniDom = (host: MiniNode) => host.childNodes.map(serializeNode).join('')
    return () => {
        target.document = previous.document
        target.Event = previous.Event
        target.Node = previous.Node
        target.serializeMiniDom = previous.serializeMiniDom
    }
}
