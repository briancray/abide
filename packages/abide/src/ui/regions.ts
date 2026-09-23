import { LAYER_FILL } from './LAYER_NAMES.ts'
import { Mismatch } from './Mismatch.ts'
import { beginLayer, endLayer } from './measureLayer.ts'

export type Region = { open: Comment; close: Comment }

// WHAT A MOUNT IS HANDED, and it is one of two things. A page the server painted is mounted on a
// NODE; a page a navigation reached, a component a caller invoked and a layout's page are mounted
// on the `Region` their markup went between. Both are a run of siblings — only where the run
// STARTS and what it hangs off differ — so the walk asks those two things here and is the same
// walk after its first step. (An arm, a slot and a row are never handed over as a `Root`: their
// mounts take a `Region` or a row's array directly, and the compiler spells where those start.)
export type Root = Node | Region

function isRegion(root: Root): root is Region {
    return !('nodeType' in root)
}

// Where a mount's walk starts: the root's first node, or null for a root with nothing in it.
export function firstIn(root: Root): Node | null {
    if (!isRegion(root)) return root.firstChild
    const first = root.open.nextSibling
    return first === root.close ? null : first
}

// What a mount's top-level nodes hang off — where a blank run the server rendered as nothing is
// put back into.
export function parentIn(root: Root): Node | null {
    return isRegion(root) ? root.close.parentNode : root
}

// 32.18 — WHETHER A REGION IS WAITING TO BE FILLED. A component the SERVER rendered arrives with
// its markup between its anchors and is hydrated; one a row builder wrote in the browser arrives
// as the anchor pair alone, and the child fills it from its own template. The empty pair is the
// whole of the signal, so nothing is added to the document to carry it.
export function isEmptyRegion(root: Root): boolean {
    return isRegion(root) && root.open.nextSibling === root.close
}

// Everything between a region's anchors, replaced by what `build` makes — or by nothing, where no
// build is given. The anchors themselves stay, which is what keeps every sibling after them
// addressable across a branch change.
//
// THE BUILD IS CALLED HERE, handed the region's own document, rather than its nodes being handed
// in. A region's document is its anchor's, and a mount's `root` is not always a node — a component
// is mounted on the `Region` its caller wrote — so every build asking `root` for one threw the first
// time a component's list grew a row. And the `abide.fill` layer then times the build as well as the
// insert, which is the whole of what filling a region costs.
export function fillRegion(
    region: Region,
    build?: (document: Document) => Node[],
): void {
    // THE PARENT IS READ BEFORE ANYTHING IS REMOVED, and the removal only happens if there is
    // one. Written as an unguarded removal followed by a `?.`-guarded insert, a region whose
    // close anchor had been detached emptied itself and then dropped the new content on the
    // floor — the one silent failure in a module where every other one refuses with 41.10 on it.
    const parent = region.close.parentNode
    if (parent === null)
        throw new Mismatch(
            `abide: this region is not in a document, so the client and the server disagree about this region's shape (41.10).`,
        )
    let node = region.open.nextSibling
    while (node !== null && node !== region.close) {
        const next = node.nextSibling
        node.remove()
        node = next
    }
    if (build === undefined) return
    beginLayer(LAYER_FILL)
    const made = build(region.close.ownerDocument as Document)
    for (const one of made) parent.insertBefore(one, region.close)
    endLayer(LAYER_FILL)
}
