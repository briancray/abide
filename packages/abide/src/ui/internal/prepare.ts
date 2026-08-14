// Parse once per call site.
//
// A template is turned ONCE into a <template> element (keyed on the `strings` identity a tagged
// template gives us for free), with each slot marked so its position can be recorded two ways:
//
//   path       child steps from the fragment root, so a BUILD can walk straight to the node
//   nodeIndex  position in a document-order ELEMENT|COMMENT walk, which is the counter the ADOPT
//              walk keeps in step with as it reads the server's markup
//
// The two are the same location described for the two jobs. A build knows the shape and wants the
// shortest route to each slot; an adopt is already walking both trees in lockstep and only needs to
// agree on WHICH node it has reached.
//
// The build used to resolve slots by creating a `TreeWalker` per instance and materialising every
// element and comment in the clone. That is 1825 ns per row against 660 ns for the path walk and
// 500 ns for the clone alone — a TreeWalker costs more to construct than a row costs to build.

import type { SlotKind, TemplateResult } from '$shared/html.ts'
import { planOf } from '$shared/internal/slots.ts'

export interface PreparedPart {
    slot: number
    /** Position in a document-order ELEMENT|COMMENT walk. What the adopt walk counts against. */
    nodeIndex: number
    /** Child index at each level, from the fragment root down. What a build navigates. */
    path: number[]
    kind: SlotKind
}

export interface Prepared {
    element: HTMLTemplateElement
    parts: PreparedPart[]
    /**
     * The single ELEMENT this template is, when that is what it is — a list row, a card, most
     * components. Cloning it directly instead of cloning the fragment around it is one fewer DOM
     * node per instance and removes the walk over the clone's children, and `path` is recorded
     * against it rather than against the fragment.
     *
     * Null for anything else, and deliberately so when the single root is a COMMENT: a top-level
     * child slot (`html`${rows}``) is its own anchor, and a part inserting before an anchor with no
     * parent has nowhere to put what it renders.
     */
    root: Element | null
    /**
     * Does the top level START with a slot rather than with markup?
     *
     * What an ADOPT reads to decide whether its leading position is a part or a node — it cannot ask
     * the claimed nodes, because the server's markup for a leading slot is already sitting in front
     * of that slot's anchor. A fact about the STRINGS, so it is derived here with `root` rather than
     * re-walked per instance: a hydrated list would otherwise pay the walk once per row.
     */
    opensWithSlot: boolean
    /**
     * Per slot: is a function value here the VALUE, rather than a thunk producing one?
     *
     * `@click=${fn}` and `&ref=${fn}` both hand the binder a raw function; every other kind treats a
     * function as the reactivity convention and wraps it in an effect. Derived from the slot kind
     * here rather than asked per patch, so `update` does one array load instead of a string compare
     * per slot per row — and so a new kind is answered in ONE place instead of by an exception list
     * at the call site, which is how `&ref` came to be unreachable.
     */
    takesRawFunction: boolean[]
}

const prepared = new WeakMap<readonly string[], Prepared>()

export function prepare(result: TemplateResult): Prepared {
    const cached = prepared.get(result.strings)
    if (cached !== undefined) return cached

    const kinds = planOf(result).kinds
    const { strings } = result
    let markup = ''

    for (let i = 0; i < strings.length; i++) {
        const text = strings[i] as string
        const kind = kinds[i]
        if (kind !== undefined && kind.kind !== 'child') {
            // The slot owns the `name=` before it; replace that markup with a locator attribute.
            markup += `${text.slice(0, text.length - kind.staticTail)} data-$${i}=""`
        } else {
            markup += text
            if (kind !== undefined) markup += `<!--$${i}-->`
        }
    }

    const element = document.createElement('template')
    element.innerHTML = markup

    const parts: PreparedPart[] = []
    record(element.content, parts, kinds, [], { index: -1 })

    const takesRawFunction: boolean[] = []
    for (let i = 0; i < kinds.length; i++) {
        const kind = kinds[i]?.kind
        takesRawFunction.push(kind === 'event' || kind === 'ref')
    }

    const content = element.content
    const only = content.firstChild
    const root = only !== null && only.nextSibling === null && only.nodeType === 1 ? (only as Element) : null
    // Recorded against the fragment above, so the first step is the one that reaches the root — and
    // an instance that clones the root DIRECTLY has already taken it.
    if (root !== null) {
        for (const part of parts) part.path.shift()
    }

    const value: Prepared = { element, parts, takesRawFunction, root, opensWithSlot: opensWithSlot(content) }
    prepared.set(result.strings, value)
    return value
}

/**
 * Does this template's top level START with a slot rather than with markup?
 *
 * Empty text nodes are stepped over for the same reason `record` skips them: they carry nothing, and
 * the adopt walk never consumes a live node for one, so counting them here would put the opening
 * position one node off the one the server wrote.
 */
function opensWithSlot(content: ParentNode): boolean {
    for (let node = content.firstChild; node !== null; node = node.nextSibling) {
        if (node.nodeType === 3 && (node as Text).data === '') continue
        return node.nodeType === 8 && (node as Comment).data.startsWith('$')
    }
    return false
}

/**
 * One pre-order walk that records both locators.
 *
 * `path` is the live stack of child indices — pushed on the way down and popped on the way back up —
 * so a part's own path is a copy of it at the moment the part is found. `counter.index` advances on
 * every element and comment and on nothing else, which is exactly what a `TreeWalker` filtered to
 * SHOW_ELEMENT|SHOW_COMMENT visits, and therefore what the adopt walk counts.
 */
function record(
    parent: ParentNode,
    parts: PreparedPart[],
    kinds: SlotKind[],
    path: number[],
    counter: { index: number },
): void {
    let childIndex = 0
    for (let node = parent.firstChild; node !== null; node = node.nextSibling, childIndex++) {
        const type = node.nodeType
        if (type !== 1 && type !== 8) continue
        counter.index++
        path.push(childIndex)
        if (type === 8) {
            const data = (node as Comment).data
            if (data.charCodeAt(0) === 36 /* $ */) {
                const slot = Number(data.slice(1))
                parts.push({
                    slot,
                    nodeIndex: counter.index,
                    path: path.slice(),
                    kind: kinds[slot] as SlotKind,
                })
            }
        } else {
            const element = node as Element
            // Copied, because removing an attribute shortens the live map underneath the loop. This
            // runs once per call site, so the array costs nothing a row ever pays for.
            for (const attribute of Array.from(element.attributes)) {
                if (!attribute.name.startsWith('data-$')) continue
                const slot = Number(attribute.name.slice(6))
                parts.push({
                    slot,
                    nodeIndex: counter.index,
                    path: path.slice(),
                    kind: kinds[slot] as SlotKind,
                })
                element.removeAttribute(attribute.name)
            }
            record(element, parts, kinds, path, counter)
        }
        path.pop()
    }
}
