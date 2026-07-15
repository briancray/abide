import { walkAnchorOrder } from '../compile/walkAnchorOrder.ts'
import { walkElementOrder } from '../compile/walkElementOrder.ts'
import { claimRun } from '../runtime/claimRun.ts'
import { HOLE_ATTRIBUTE } from '../runtime/HOLE_ATTRIBUTE.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { commentData } from './commentData.ts'
import { depthZeroNodes } from './depthZeroNodes.ts'
import { domAnchorAdapter } from './domAnchorAdapter.ts'
import { domElementAdapter } from './domElementAdapter.ts'
import { foreignWrapperTag } from './foreignWrapperTag.ts'
import { isElement } from './isElement.ts'
import { markerDepthDelta } from './markerDepthDelta.ts'
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
            continue
        }
        depth += markerDepthDelta(data)
    }
    return undefined
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
        /* Element holes via the ONE shared rule (`walkElementOrder`) — the same element-only
           pre-order the compiler numbers `elIndex` with. Record each `HOLE_ATTRIBUTE`
           element's path and strip the marker so a clone never carries it into the live DOM. */
        const elementPaths: number[][] = []
        walkElementOrder(Array.from(source.childNodes), domElementAdapter, (node, path) => {
            elementPaths.push(path)
            ;(node as Element).removeAttribute(HOLE_ATTRIBUTE)
        })
        compiled = { source, elementPaths, topLevelCount: source.childNodes.length }
        cache.set(key, compiled)
    }
    return compiled
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
        claimRun(hydration, parent, topLevelCount, topLevel)
    } else {
        const children = source.childNodes
        /* Stage clones in a fragment ONLY for a live (connected) parent, where one
           append reflows once instead of per clone. A detached parent triggers no
           reflow on append, so the fragment is pure overhead there — skip it and
           append direct. `topLevel` collects each clone either way for anchor/
           element-hole resolution. */
        const target: Node = parent.isConnected ? document.createDocumentFragment() : parent
        for (let index = 0; index < children.length; index += 1) {
            const clone = (children[index] as Node).cloneNode(true)
            topLevel.push(clone)
            target.appendChild(clone)
        }
        if (target !== parent) {
            parent.appendChild(target)
        }
    }
    /* Anchor holes via the ONE shared ordering rule (`walkAnchorOrder`) — the same traversal
       the compiler numbers `anIndex` with. The top-level list is depth-0-filtered up front (a
       nested range can sit among the top-level run); the adapter filters each deeper level. */
    const an: Node[] = []
    walkAnchorOrder(depthZeroNodes(topLevel), domAnchorAdapter, (anchor) => {
        an.push(anchor as Node)
    })
    return {
        el: elementPaths.map((path) => resolveElementHole(topLevel, path)),
        an,
    }
}
