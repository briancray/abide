import type { Attribute, Branch, TemplateNode } from './TemplateNode.ts'

// ONE walk over the tree BOTH emitters read, so the position the server writes and the position
// the client walks to cannot drift: the client looks a binding's address up here rather than
// recomputing it beside the markup.
//
// A TEXT RUN IS THE UNIT, not a slot. Adjacent text nodes MERGE when a browser parses markup, so
// `<p>{label}: {count}</p>` arrives as the single text node `clicks: 0` however it was written.
// Every scheme that lets those two slots be written independently has to put something between
// them — a marker, or a `splitText` — and both change what `childNodes` and `firstChild` answer,
// which a compiler is not allowed to do.
//
// So the run is written WHOLE: one text node, one `data` write, recomputed from all its parts. A
// change to one part rewrites the run, which costs the same single write it would have cost
// anyway plus a string join, and leaves the document identical to the one the author wrote.
//
// THE PATH IS OVER THE PARSED TREE, which is why runs are merged here rather than left as
// separate nodes: `childNodes[2]` means the third node a BROWSER sees, and a compiler that counts
// its own unmerged pieces is counting something no document has.

export type TextRun = {
    // Child indices from the region root down to the text node. A NEGATIVE step is a region
    // reference: `-1 - n` means "region n in this parent", and the step after it is how many
    // nodes past its closing anchor to count, and it may stand ANYWHERE in a path. The walk in
    // `nodeAt` decodes it; `regionAt` is what it counts with.
    path: number[]
    // The pieces, in order. A part with no `holder` is static text; one with a holder is an
    // expression, `text` its source and `holder` its node — the key its lowering is found under
    // (`Lowering.slot`).
    parts: { text: string; holder: TemplateNode | null }[]
    // Whether the run can render as NO NODE AT ALL. Every part is an expression, so a value that
    // stringifies to `''` writes nothing and the parent holds one fewer child than every path
    // after it in that parent assumes. One static character anywhere in the run and it cannot
    // happen, which is why this is a property of the run rather than of the binding.
    blank: boolean
}

export type HandlerBinding = {
    // Child indices from the region root down to the element.
    path: number[]
    event: string
    attribute: Attribute
}

// A `{#for}`: ONE body, planned once and instantiated per row. A row's paths are the row's own,
// exactly as an arm's are — which is the same property, now doing the work it was built for.
export type ListPlan = {
    kind: 'for'
    index: number
    parent: number[]
    // The block itself: its item, index, key, subject and body, and the key its lowering is
    // found under.
    block: TemplateNode & { kind: 'block'; block: 'for' }
    plan: TemplatePlan
}

// A `{#if}` and its arms. Each arm is planned as its OWN region — its bindings are addressed from
// the region's own root, so two arms may hold the same paths and neither can see the other's.
export type RegionPlan = {
    kind: 'if'
    // Which region this is among its parent's, in document order. The client counts opening
    // anchors to find it.
    index: number
    // Where the region's anchor pair sits: the path to its PARENT, then its index there.
    parent: number[]
    // The arm's own nodes are `branch.children`, so the CLIENT can emit its markup for a branch
    // swap using the same emitter the server used. Two copies of that emitter is two escaping
    // rules.
    branches: { branch: Branch; plan: TemplatePlan }[]
}

export type TemplatePlan = {
    runs: TextRun[]
    handlers: HandlerBinding[]
    regions: (RegionPlan | ListPlan)[]
}

// `first` is the index the root's first node stands at — 0, except in a row that carries its own
// anchor at the head of its nodes.
export function planTemplate(
    template: TemplateNode[],
    first = 0,
): TemplatePlan {
    const plan: TemplatePlan = {
        runs: [],
        handlers: [],
        regions: [],
    }
    walk(template, [], plan, first)
    return plan
}

function isTextish(node: TemplateNode): boolean {
    return node.kind === 'text' || node.kind === 'expression'
}

function walk(
    nodes: TemplateNode[],
    path: number[],
    plan: TemplatePlan,
    first = 0,
): void {
    // `childIndex` counts what a BROWSER will see: a run of adjacent text and expressions is one
    // node however many pieces it was written as.
    let childIndex = first
    // Once a region has been passed, every sibling after it is counted from that region's closing
    // anchor rather than by child index — the region's own length depends on a value, so the
    // indices after it are not a fixed thing to address by.
    let afterRegion = -1
    let sinceRegion = 0
    let at = 0
    // WHICH REGION THIS IS AMONG ITS PARENT'S, which is what `regionAt` counts: opening anchors
    // directly inside one node. `plan.regions` is FLAT across the whole template — `walk` recurses
    // into an element's children with the same plan — so its length is not this number, and the
    // two part company the moment a second parent holds a region.
    let regionIndex = 0

    const place = (): number[] =>
        afterRegion === -1
            ? [...path, childIndex]
            : [...path, -1 - afterRegion, sinceRegion]

    while (at < nodes.length) {
        const node = nodes[at] as TemplateNode

        if (isTextish(node)) {
            const parts: TextRun['parts'] = []
            let dynamic = false
            let blank = true
            while (at < nodes.length && isTextish(nodes[at] as TemplateNode)) {
                const piece = nodes[at] as TemplateNode
                if (piece.kind === 'text') {
                    parts.push({ text: piece.text, holder: null })
                    if (piece.text !== '') blank = false
                } else if (piece.kind === 'expression') {
                    parts.push({ text: piece.source, holder: piece })
                    dynamic = true
                }
                at += 1
            }
            // A run with no expression is static markup: the server writes it and nothing ever
            // touches it again, so it needs neither a binding nor an address.
            if (dynamic) plan.runs.push({ path: place(), parts, blank })
            childIndex += 1
            sinceRegion += 1
            continue
        }

        if (node.kind === 'block') {
            const index = regionIndex
            regionIndex += 1
            if (node.block === 'for') {
                // 32.14 — the body is planned ONCE. Every row instantiates the same plan, so a
                // thousand rows emit one binding site rather than a thousand, which is the shape
                // the server bench found straight-line emission losing 6x to.
                plan.regions.push({
                    kind: 'for',
                    index,
                    parent: [...path],
                    block: node,
                    // A row whose body has several top-level nodes is handed over with its own
                    // anchor first, so its first top-level node stands at 1.
                    plan: planTemplate(
                        node.children,
                        isSingleRooted(node.children) ? 0 : 1,
                    ),
                })
            } else {
                // 32.13 — the block is a REGION. Its arms are planned apart, each from its own
                // root, so the same paths in two arms mean two different things.
                plan.regions.push({
                    kind: 'if',
                    index,
                    parent: [...path],
                    branches: node.branches.map((branch: Branch) => ({
                        branch,
                        plan: planTemplate(branch.children),
                    })),
                })
            }
            afterRegion = index
            sinceRegion = 0
            childIndex += 1
            at += 1
            continue
        }

        if (node.kind === 'element') {
            const here = place()
            for (const attribute of node.attributes) {
                if (!attribute.expression || !isEventName(attribute.lowerName))
                    continue
                // 32.5 — a native listener on the element itself, reached by the same walk a
                // text node is, so nothing is added to the document to find it.
                plan.handlers.push({
                    path: here,
                    event: attribute.lowerName.slice(2),
                    attribute,
                })
            }
            walk(node.children, here, plan)
        }
        childIndex += 1
        sinceRegion += 1
        at += 1
    }
}

// `onclick={f}` is a listener, never an attribute — the plan records it and the server writes
// nothing for it, so the two emitters have to agree on the test. One copy is that agreement.
// Given the FOLDED name (`Attribute.lowerName`).
export function isEventName(lowerName: string): boolean {
    return lowerName.length > 2 && lowerName.startsWith('on')
}

export function isHead(node: TemplateNode): boolean {
    return node.kind === 'element' && node.lowerTag === 'head'
}

// Whether a `{#for}` body is ONE top-level element and nothing else. That row IS its element, so
// the nodes between the region's anchors are the rows and nothing has to be added to tell them
// apart. `<dt>{k}</dt><dd>{v}</dd>` is not — counting elements there finds four rows in a list of
// two — and that body gets a per-ROW anchor instead.
//
// Formatting whitespace is already gone by here (33.17, 33.18), so a body written across lines is
// still single-rooted.
export function isSingleRooted(children: TemplateNode[]): boolean {
    return (
        children.length === 1 &&
        (children[0] as TemplateNode).kind === 'element'
    )
}
