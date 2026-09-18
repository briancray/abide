import type { TemplateNode } from './TemplateNode.ts'

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
    // Child indices from the region root down to the text node.
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

export type TemplatePlan = {
    runs: TextRun[]
    handlers: HandlerBinding[]
    // Where a node's run index is looked up by the server emitter, keyed by the first node of the
    // run so the emitter can tell a run it must join from one it can write as a literal.
    runOf: Map<TemplateNode, number>
}

export function planTemplate(template: TemplateNode[]): TemplatePlan {
    const plan: TemplatePlan = { runs: [], handlers: [], runOf: new Map() }
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
    let at = 0
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
            // A run with no expression in it is static markup and needs no binding and no
            // address: the server writes it and nothing ever touches it again.
            if (dynamic) {
                plan.runOf.set(first, plan.runs.length)
                plan.runs.push({ path: [...path, childIndex], parts })
            }
            childIndex += 1
            continue
        }

        if (node.kind === 'element') {
            const here = [...path, childIndex]
            for (const attribute of node.attributes) {
                if (!attribute.expression || !isEventName(attribute.name))
                    continue
                // 32.5 — a native listener on the element itself. The element is reached by the
                // same path walk as a text node, so nothing is added to the document to find it.
                plan.handlers.push({
                    path: here,
                    event: attribute.name.slice(2).toLowerCase(),
                    source: attribute.value,
                })
            }
            walk(node.children, here, plan)
        }
        childIndex += 1
        at += 1
    }
}

function isEventName(name: string): boolean {
    return name.length > 2 && name.startsWith('on')
}
