import type { Branch, TemplateNode } from './TemplateNode.ts'

// ONE walk, consulted by BOTH emitters, so the position the server writes and the position the
// client walks to cannot drift: it is looked up, not recomputed.
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
    // nodes past its closing anchor to count. See `regionAt`/`afterRegion`.
    path: number[]
    // The pieces, in order. A string is static text; an expression is source to evaluate.
    parts: { kind: 'static' | 'expression'; text: string }[]
}

export type HandlerBinding = {
    // Child indices from the region root down to the element.
    path: number[]
    event: string
    source: string
}

// A `{#if}` and its arms. Each arm is planned as its OWN region — its bindings are addressed from
// the region's own root, so two arms may hold the same paths and neither can see the other's.
export type RegionPlan = {
    // Which region this is among its parent's, in document order. The client counts opening
    // anchors to find it.
    index: number
    // Where the region's anchor pair sits: the path to its PARENT, then its index there.
    parent: number[]
    branches: {
        subject: string
        plan: TemplatePlan
        // The arm's own nodes, so the CLIENT can emit its markup for a branch swap using the same
        // emitter the server used. Two copies of that emitter is two escaping rules.
        children: TemplateNode[]
    }[]
}

export type TemplatePlan = {
    runs: TextRun[]
    handlers: HandlerBinding[]
    regions: RegionPlan[]
    runOf: Map<TemplateNode, number>
}

export function planTemplate(template: TemplateNode[]): TemplatePlan {
    const plan: TemplatePlan = {
        runs: [],
        handlers: [],
        regions: [],
        runOf: new Map(),
    }
    walk(template, [], plan)
    return plan
}

function isTextish(node: TemplateNode): boolean {
    return node.kind === 'text' || node.kind === 'expression'
}

function walk(nodes: TemplateNode[], path: number[], plan: TemplatePlan): void {
    // `childIndex` counts what a BROWSER will see: a run of adjacent text and expressions is one
    // node however many pieces it was written as.
    let childIndex = 0
    // Once a region has been passed, every sibling after it is counted from that region's closing
    // anchor rather than by child index — the region's own length depends on a value, so the
    // indices after it are not a fixed thing to address by.
    let afterRegion = -1
    let sinceRegion = 0
    let at = 0

    const place = (): number[] =>
        afterRegion === -1
            ? [...path, childIndex]
            : [...path, -1 - afterRegion, sinceRegion]

    while (at < nodes.length) {
        const node = nodes[at] as TemplateNode

        if (isTextish(node)) {
            const parts: TextRun['parts'] = []
            const first = node
            let dynamic = false
            while (at < nodes.length && isTextish(nodes[at] as TemplateNode)) {
                const piece = nodes[at] as TemplateNode
                if (piece.kind === 'text')
                    parts.push({ kind: 'static', text: piece.text })
                else if (piece.kind === 'expression') {
                    parts.push({ kind: 'expression', text: piece.source })
                    dynamic = true
                }
                at += 1
            }
            // A run with no expression is static markup: the server writes it and nothing ever
            // touches it again, so it needs neither a binding nor an address.
            if (dynamic) {
                plan.runOf.set(first, plan.runs.length)
                plan.runs.push({ path: place(), parts })
            }
            childIndex += 1
            sinceRegion += 1
            continue
        }

        if (node.kind === 'block') {
            // 32.13 — the block is a REGION. Its arms are planned apart, each from its own root,
            // so the same paths in two arms mean two different things and neither is reachable
            // from the other.
            const index = plan.regions.length
            plan.regions.push({
                index,
                parent: [...path],
                branches: node.branches.map((branch: Branch) => ({
                    subject: branch.subject,
                    plan: planTemplate(branch.children),
                    children: branch.children,
                })),
            })
            afterRegion = index
            sinceRegion = 0
            childIndex += 1
            at += 1
            continue
        }

        if (node.kind === 'element') {
            const here = place()
            for (const attribute of node.attributes) {
                if (!attribute.expression || !isEventName(attribute.name))
                    continue
                // 32.5 — a native listener on the element itself, reached by the same walk a
                // text node is, so nothing is added to the document to find it.
                plan.handlers.push({
                    path: here,
                    event: attribute.name.slice(2).toLowerCase(),
                    source: attribute.value,
                })
            }
            walk(node.children, here, plan)
        }
        childIndex += 1
        sinceRegion += 1
        at += 1
    }
}

function isEventName(name: string): boolean {
    return name.length > 2 && name.startsWith('on')
}
