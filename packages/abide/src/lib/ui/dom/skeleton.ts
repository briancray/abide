import { claimChild } from '../runtime/claimChild.ts'
import { HOLE_ATTRIBUTE } from '../runtime/HOLE_ATTRIBUTE.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { foreignWrapperTag } from './foreignWrapperTag.ts'
import type { SkeletonHoles } from './types/SkeletonHoles.ts'

type CompiledSkeleton = {
    /* The node whose children are the skeleton's top-level run — the template content,
       or a foreign wrapper element (`<svg>`/`<math>`) the run was parsed inside. */
    source: Node
    /* Element holes, in pre-order — each an element-only-index path from a top-level
       node. Element-only indexing keeps a path stable: a reactive text value is a text
       node, so its width never shifts an element hole between the empty client skeleton
       and the value-filled server DOM. */
    elementPaths: number[][]
    topLevelCount: number
}

/* Parsed-once skeleton per unique string, keyed by the owning document (see
   `templateFor` for the per-document rationale). */
const CACHES = new WeakMap<object, Map<string, CompiledSkeleton>>()

/* An element carries `hasAttribute`; text/comment nodes do not. Used instead of
   `nodeType` so the walk runs under the test mini-dom too. */
function isElement(node: Node): node is Element {
    return typeof (node as Element).hasAttribute === 'function'
}

/* A child component's mount wrapper (`abide-<name>`, see `componentWrapperTag`). Its
   content is a SEPARATE skeleton (the child's own), so the parent's walks must treat it
   as opaque: in the shallow skeleton it's an empty leaf, so the compiler counts no
   anchors inside it; on hydrate it's populated, so a descent would over-collect the
   child's anchors and shift every parent index past it (same hazard as a block range,
   but bounded by the wrapper element instead of `[`…`]` markers). */
function isComponentWrapper(node: Node): boolean {
    return isElement(node) && (node.tagName ?? '').toLowerCase().startsWith('abide-')
}

/* A comment node's data, or undefined for elements/text. A comment is a node that is
   neither an element (`hasAttribute`) nor a text node (`splitText`); the mini-dom
   exposes no `nodeType`, so detect by method. */
function commentData(node: Node): string | undefined {
    if (isElement(node) || typeof (node as Text).splitText === 'function') {
        return undefined
    }
    return (node as Comment).data
}

/* Block-range boundary markers. A control-flow block's rendered content sits between an
   OPEN and CLOSE comment: `[`…`]` for each rows / if / switch / slot ranges, and named
   `abide:…`…`/abide:…` boundaries for await / try / snippet / html. The skeleton's own
   anchor (`a`) sits OUTSIDE any such range. */
function isOpenMarker(data: string): boolean {
    return data === '[' || data.startsWith('abide:')
}
function isCloseMarker(data: string): boolean {
    return data === ']' || data.startsWith('/abide:')
}

/* The `index`-th depth-0 ELEMENT among `children` — skipping text/comment nodes AND any
   element nested inside a block's rendered range (between `[`…`]` / `abide:…` boundaries),
   which belongs to that block's own skeleton. The compiler indexes element holes over the
   SHALLOW template (block positions are `<!--a-->` anchors, no content), so on hydrate the
   expanded tree must skip that inline content or a hole positioned after a block shifts. In
   create mode the clone is shallow (no markers), so depth stays 0 — a plain element count. */
function elementChildAt(children: ArrayLike<Node>, index: number): Element | undefined {
    let seen = 0
    let depth = 0
    for (let cursor = 0; cursor < children.length; cursor += 1) {
        const child = children[cursor] as Node
        const data = commentData(child)
        if (data === undefined) {
            if (isElement(child) && depth === 0) {
                if (seen === index) {
                    return child
                }
                seen += 1
            }
        } else if (isCloseMarker(data)) {
            depth -= 1
        } else if (isOpenMarker(data)) {
            depth += 1
        }
    }
    return undefined
}

/* Records each element hole's element-only path in PRE-ORDER (the `HOLE_ATTRIBUTE`
   marks which) and strips the marker — the compiler assigns element-hole indices in the
   same pre-order, so the arrays line up without numbering the markers. */
function indexElementHoles(container: Node, prefix: number[], paths: number[][]): void {
    const children = container.childNodes
    let elementIndex = 0
    for (let cursor = 0; cursor < children.length; cursor += 1) {
        const child = children[cursor] as Node
        if (!isElement(child)) {
            continue
        }
        const path = [...prefix, elementIndex]
        elementIndex += 1
        if (child.hasAttribute(HOLE_ATTRIBUTE)) {
            paths.push(path)
            child.removeAttribute(HOLE_ATTRIBUTE)
        }
        indexElementHoles(child, path, paths)
    }
}

/* Collects THIS skeleton's own anchor holes (`a` comments) in document order, present in
   both the cloned skeleton and the server DOM (text-width-independent). The compiler emits
   anchors in the same order, so the arrays line up.

   In hydrate mode the claimed tree is FULLY EXPANDED — a nested block's rendered content
   (each rows, branches, await/try boundaries) sits inline — so a naive descent would also
   collect the inner block's anchors, which belong to that block's OWN skeleton, shifting
   every index past the first block. Block content is bounded by range markers, so track
   depth per sibling list and take an anchor (and recurse into an element) only at depth 0,
   where the skeleton's own structure lives. In create mode the clone is shallow (the blocks
   have not built yet — no markers), so depth stays 0 and this is a plain document scan. */
function scanAnchors(nodes: ArrayLike<Node>, anchors: Node[]): void {
    let depth = 0
    for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index] as Node
        const data = commentData(node)
        if (data === undefined) {
            /* Recurse into this skeleton's own elements, but NOT a child component's
               wrapper — its anchors belong to the child's skeleton (see above). */
            if (isElement(node) && depth === 0 && !isComponentWrapper(node)) {
                scanAnchors(node.childNodes, anchors)
            }
        } else if (isCloseMarker(data)) {
            depth -= 1
        } else if (isOpenMarker(data)) {
            depth += 1
        } else if (data === 'a' && depth === 0) {
            anchors.push(node)
        }
    }
}

/* When `parent` is foreign (or a control-flow fragment inside foreign content), the
   skeleton's own markup carries no foreign ancestor, so a bare `<circle>` would parse
   into the HTML namespace. Parse it inside the matching wrapper so the parser
   namespaces the run; key the cache by wrapper too, since one string can be realized
   in either context. */
function compile(html: string, wrapper: string | undefined): CompiledSkeleton {
    let cache = CACHES.get(document)
    if (cache === undefined) {
        cache = new Map()
        CACHES.set(document, cache)
    }
    const key = wrapper === undefined ? html : `${wrapper} ${html}`
    let compiled = cache.get(key)
    if (compiled === undefined) {
        const template = document.createElement('template')
        template.innerHTML = wrapper === undefined ? html : `<${wrapper}>${html}</${wrapper}>`
        const source =
            wrapper === undefined ? template.content : (template.content.firstChild as Node)
        const elementPaths: number[][] = []
        indexElementHoles(source, [], elementPaths)
        compiled = { source, elementPaths, topLevelCount: source.childNodes.length }
        cache.set(key, compiled)
    }
    return compiled
}

/* Walks an element-only path from the top-level node list to the target element. A step
   that resolves to nothing means the claimed server run is missing an element the skeleton
   expects here — a hydration desync; throw AT it (naming the path) rather than returning
   the undefined that derefs in the downstream `mountChild`/`attr`, far from the cause. */
function resolveElementHole(topLevel: ArrayLike<Node>, path: number[]): Element {
    let node = elementChildAt(topLevel, path[0] as number)
    for (let depth = 1; depth < path.length && node !== undefined; depth += 1) {
        node = elementChildAt(node.childNodes, path[depth] as number)
    }
    if (node === undefined) {
        throw new Error(
            `[abide] hydration desync: skeleton element hole [${path.join(',')}] resolved to no node — the server DOM is missing an element the client build expects here.`,
        )
    }
    return node
}

/*
Realizes a compiled skeleton under `parent` and returns its holes: `el` the element
holes (attribute/listener/bind), in pre-order; `an` the anchor holes (reactive text,
control flow, components), in document order. The browser's parser is the sole
tree-builder here, so foreign content (SVG/MathML) lands in the correct namespace and
`cloneNode` preserves it — a hand-rolled `createElement` tree-builder could not.

Element holes resolve by element-only path (stable against text-value width, computed
client-side — no server marker). Anchor holes resolve by scanning for their `a` comment
markers (present in both clone and server DOM). Create mode clones the parsed top-level
nodes; hydrate mode claims the matching server run.
*/
// @documentation plumbing
export function skeleton(parent: Node, html: string): SkeletonHoles {
    const { source, elementPaths, topLevelCount } = compile(html, foreignWrapperTag(parent))
    const hydration = RENDER.hydration
    const topLevel: Node[] = []
    if (hydration !== undefined) {
        let node = claimChild(hydration, parent)
        for (let count = 0; count < topLevelCount && node !== null; count += 1) {
            topLevel.push(node)
            node = node.nextSibling
        }
        hydration.next.set(parent, node)
    } else {
        const children = source.childNodes
        for (let index = 0; index < children.length; index += 1) {
            const clone = (children[index] as Node).cloneNode(true)
            topLevel.push(clone)
            parent.appendChild(clone)
        }
    }
    const an: Node[] = []
    scanAnchors(topLevel, an)
    return {
        el: elementPaths.map((path) => resolveElementHole(topLevel, path)),
        an,
    }
}
