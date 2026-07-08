import type { InterpolationClassifier } from './types/InterpolationClassifier.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import type { TextPart } from './types/TextPart.ts'

/*
Type-directed lowering of text-position interpolations (ADR-0019, Stage C). Walks
the parsed template and, for each `{expr}` part the classifier resolves to a
`promise`, replaces it with a synthesized STREAMING `await` node — the same
TemplateNode shape the explicit `{#await expr}{:then v}{v}{/await}` block parses
to, so it flows through the existing `awaitPlan`/`generateStreamingAwait` and
client await runtime unchanged. An `asyncIterable` interpolation is left untouched
here (Stage D handles cell injection); a `sync` one is left as-is.

Splitting mirrors the parser's `{await}` handling: an await block can only stand
where element content stands, so a promise part splits its surrounding text run —
the parts before it stay one text node, the await node stands between, the parts
after become another text node. Called only when a classifier is available; without
one the template is returned untouched, preserving today's plain-value binding.
*/
export function lowerAsyncInterpolations(
    nodes: TemplateNode[],
    classify: InterpolationClassifier,
): TemplateNode[] {
    /* Per-call counter for the synthesized `then` binding (`__v${n}`), so nested and
       sibling lowerings never collide on a name. */
    const counter = { next: 0 }
    return lowerList(nodes, classify, counter)
}

/* Lowers a sibling list, splitting any text node that carries a promise interpolation. */
function lowerList(
    nodes: TemplateNode[],
    classify: InterpolationClassifier,
    counter: { next: number },
): TemplateNode[] {
    const result: TemplateNode[] = []
    for (const node of nodes) {
        if (node.kind === 'text') {
            appendLoweredText(node.parts, classify, counter, result)
            continue
        }
        if ('children' in node) {
            node.children = lowerList(node.children, classify, counter)
        }
        result.push(node)
    }
    return result
}

/* Splits a text node's parts around each promise interpolation, pushing the
   surrounding runs as text nodes and the promise parts as streaming await nodes. */
function appendLoweredText(
    parts: TextPart[],
    classify: InterpolationClassifier,
    counter: { next: number },
    out: TemplateNode[],
): void {
    let run: TextPart[] = []
    for (const part of parts) {
        if (
            part.kind === 'expression' &&
            part.loc !== undefined &&
            classify(part.loc, part.code) === 'promise'
        ) {
            if (run.length > 0) {
                out.push({ kind: 'text', parts: run })
                run = []
            }
            out.push(streamingAwaitNode(part.code, part.loc, counter.next++))
            continue
        }
        /* TODO(stage D): an `asyncIterable` interpolation stays a plain part here — Stage D
           injects a draining cell instead of lowering it to an await block. */
        run.push(part)
    }
    if (run.length > 0) {
        out.push({ kind: 'text', parts: run })
    }
}

/* Synthesizes the streaming `await` node for a promise interpolation: no inline
   `then` binding on the head (`blocking:false`), an explicit `then` branch binding
   a fresh `__v${n}` and rendering it as the branch's sole text child. */
function streamingAwaitNode(code: string, loc: number, index: number): TemplateNode {
    const binding = `__v${index}`
    return {
        kind: 'await',
        promise: code,
        blocking: false,
        as: undefined,
        children: [
            {
                kind: 'branch',
                branch: 'then',
                as: binding,
                children: [{ kind: 'text', parts: [{ kind: 'expression', code: binding }] }],
            },
        ],
        loc,
        asLoc: undefined,
    }
}
