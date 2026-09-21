import type { Attribute, Branch, TemplateNode } from './TemplateNode.ts'

// THE CLIENT'S ADDRESSES, and the CLASSIFICATION both emitters share. Two different things live
// here and only the second is common to the two lanes, which is worth being exact about because
// the file used to say the walk itself was:
//
// THE PLAN IS WALKED BY `emitClient` ALONE. A server writes markup in tree order and never
// addresses a node, so it has nothing to look up — `emitComponent` reads the template directly
// and does not call `planTemplate` at all. What the plan buys is that the client looks a binding's
// address up here rather than recomputing it beside the markup.
//
// WHAT BOTH EMITTERS READ IS THE PREDICATES — `isComponentTag`, `isEventName`, `isHead`,
// `isSingleRooted`, `isStyleProperty`. THAT is what stops the two lanes drifting: an `onclick` the
// server declines to write and the client binds as a listener is one predicate answering twice,
// and one copy is that agreement. So a decision that must bind BOTH lanes belongs in a predicate
// here, not in the walk below — the walk is a place only one lane will ever reach.
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

// 32.4 — `name={expr}` IS REACTIVE, which the server half alone cannot make it: it writes the
// value standing at render and nothing ever writes it again. The path is the ELEMENT's, reached by
// the same walk a listener's is, so nothing is added to the document to find it.
//
// `property` IS THE `style:prop` NAME and `undefined` for an ordinary attribute. The two are one
// binding site with two writes rather than two plans, because what differs is only the call the
// value is handed to — 32.11 sets one property, everything else sets one attribute.
export type AttributeBinding = {
    path: number[]
    attribute: Attribute
    property: string | undefined
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

// 32.19 — AN INVOCATION IS A REGION, and it is one for a reason the blocks are not: how many
// top-level nodes the child writes is a fact about ANOTHER FILE. Every sibling after it would
// otherwise be addressed by counting through a shape this file cannot see, so the anchor pair the
// server wrote is what the walk stops at — and the child mounts against it.
export type ComponentPlan = {
    kind: 'component'
    index: number
    parent: number[]
    node: TemplateNode & { kind: 'element' }
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
    // Whether these nodes stand inside a block's body — see `planTemplate`.
    inRegion: boolean
    runs: TextRun[]
    handlers: HandlerBinding[]
    attributes: AttributeBinding[]
    regions: (RegionPlan | ListPlan | ComponentPlan)[]
}

// `first` is the index the root's first node stands at — 0, except in a row that carries its own
// anchor at the head of its nodes.
// `inRegion` is whether these nodes are a block's body rather than the page's own template. A
// region is the one place the CLIENT builds markup — a new row, a swapped arm — and the child's
// markup lives in its own server module, which a browser may not reach.
export function planTemplate(
    template: TemplateNode[],
    first = 0,
    inRegion = false,
): TemplatePlan {
    const plan: TemplatePlan = {
        inRegion,
        runs: [],
        handlers: [],
        attributes: [],
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
                        true,
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
                        plan: planTemplate(branch.children, 0, true),
                    })),
                })
            }
            afterRegion = index
            sinceRegion = 0
            childIndex += 1
            at += 1
            continue
        }

        if (node.kind === 'element' && isComponentTag(node.tag)) {
            plan.regions.push({
                kind: 'component',
                index: regionIndex,
                parent: [...path],
                node,
            })
            afterRegion = regionIndex
            regionIndex += 1
            sinceRegion = 0
            childIndex += 1
            at += 1
            continue
        }

        if (node.kind === 'element') {
            const here = place()
            for (const attribute of node.attributes) {
                if (!attribute.expression) continue
                if (isEventName(attribute.lowerName)) {
                    // 32.5 — a native listener on the element itself, reached by the same walk a
                    // text node is, so nothing is added to the document to find it.
                    plan.handlers.push({
                        path: here,
                        event: attribute.lowerName.slice(2),
                        attribute,
                    })
                    continue
                }
                // 32.12's spread is not built, and an emitter that planned one would bind a name
                // beginning `...` as an attribute.
                if (attribute.name.startsWith('...')) continue
                // 32.11, 32.21 — EVERY `style:prop` ON ONE ELEMENT IS ONE `style` ATTRIBUTE,
                // merged by the server emitter. So a plain `style={expr}` standing beside one
                // cannot be written back on its own: `setAttribute('style', …)` replaces the whole
                // declaration list and takes the `style:` props with it, and the two bindings then
                // overwrite each other in whichever order they re-ran.
                //
                // ALLOWED AND LEFT UNBOUND, rather than refused. The page still RENDERS right —
                // the server writes both halves into the one merged attribute — so the only thing
                // a build error would buy is breaking a page that works today for a clause that
                // is not built. What it costs is the hole: this one attribute keeps the value
                // standing at render where 32.4 says it moves, and nothing reports that.
                //
                // 32.21 IS WHAT CLOSES IT, not a binding here: an interpolated `style` lowers to
                // `style:prop` under a static name and is never built as a string, and then there
                // is no whole-attribute write left to clobber anything. This exception leaves with
                // it — until then a binding would be wrong half the time, because
                // `setAttribute('style', …)` replaces the whole declaration list and takes the
                // `style:` props with it, whichever order the two re-ran in.
                if (
                    attribute.lowerName === 'style' &&
                    node.attributes.some(isStyleProperty)
                )
                    continue
                plan.attributes.push({
                    path: here,
                    attribute,
                    property: isStyleProperty(attribute)
                        ? attribute.name.slice('style:'.length)
                        : undefined,
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
// 32.19 — `<Row/>` is a component and `<row/>` is the element. An HTML tag is matched
// case-insensitively everywhere else (`lowerTag`), and this is the one comparison where the
// author's own spelling decides. Here rather than beside the emitter that calls it most, because
// the plan is what both emitters read and the edge the other way round is a cycle.
export function isComponentTag(tag: string): boolean {
    const first = tag.charCodeAt(0)
    return first >= 65 && first <= 90
}

export function isEventName(lowerName: string): boolean {
    return lowerName.length > 2 && lowerName.startsWith('on')
}

// 32.11 — `style:prop` sets ONE style property. Here rather than beside the emitter that writes
// the declaration out, for `isComponentTag`'s reason: the plan is what both emitters read, and an
// edge from the plan to an emitter is a cycle. The prefix is matched on the FOLDED name; the
// property itself is read from the author's spelling, because a custom property is case-sensitive.
export function isStyleProperty(attribute: Attribute): boolean {
    return (
        attribute.lowerName.length > 6 &&
        attribute.lowerName.startsWith('style:')
    )
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
    const only = children[0]
    return (
        children.length === 1 &&
        only !== undefined &&
        only.kind === 'element' &&
        // A COMPONENT IS NOT ONE NODE. How many top-level nodes it writes is a fact about another
        // file, so a row that is one invocation carries its own anchor like any multi-root row —
        // without it, `rowsIn` counts the CHILD's elements and finds as many rows as the child
        // has top-level elements.
        !isComponentTag(only.tag)
    )
}
