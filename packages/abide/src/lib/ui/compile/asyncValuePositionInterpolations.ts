import type { TemplateNode } from './types/TemplateNode.ts'
import type { ValuePositionInterpolation } from './types/ValuePositionInterpolation.ts'

/*
Collects every interpolation sitting in a NON-content value position across a parsed
template — the positions Stage E guards (ADR-0019): an attribute value, an `{#if}` /
`{#switch}` head, and a `{#each}`/`{#for}` iterable. Text-child positions are NOT
collected: promise/asyncIterable text interpolations lower to a streaming await /
stream cell (Stages C+D), so they render fine. A `{#for await}` iterable is included
but tagged `for await` so the caller allows an `AsyncIterable` there.

Shared by both guard sites: the build front-end (`lowerAsyncInterpolations`, which
classifies each and throws) and `abide check` (`collectAbideDiagnostics`, which
classifies each and pushes a diagnostic). Only positions the parser tracked an offset
for are collected — an untracked span (`loc === undefined`) has no classifier key.
*/
export function asyncValuePositionInterpolations(
    nodes: TemplateNode[],
): ValuePositionInterpolation[] {
    const found: ValuePositionInterpolation[] = []
    collect(nodes, found)
    return found
}

/* Recursive walk: pushes each node's value-position interpolations, then descends
   into its children so nested elements and blocks are reached. */
function collect(nodes: TemplateNode[], found: ValuePositionInterpolation[]): void {
    for (const node of nodes) {
        if (node === undefined) {
            continue
        }
        if (node.kind === 'element') {
            for (const attr of node.attrs) {
                /* `name={expr}` — a plain reactive value bind. */
                if (attr.kind === 'expression' && attr.loc !== undefined) {
                    found.push({ loc: attr.loc, code: attr.code, position: 'attribute' })
                    continue
                }
                /* `name="… {expr} …"` — each interpolated part stringifies into the value. */
                if (attr.kind === 'interpolated') {
                    for (const part of attr.parts) {
                        if (part.kind === 'expression' && part.loc !== undefined) {
                            found.push({ loc: part.loc, code: part.code, position: 'attribute' })
                        }
                    }
                }
            }
        } else if (node.kind === 'if' && node.loc !== undefined) {
            found.push({ loc: node.loc, code: node.condition, position: 'if' })
        } else if (node.kind === 'switch' && node.loc !== undefined) {
            found.push({ loc: node.loc, code: node.subject, position: 'switch' })
        } else if (node.kind === 'each' && node.loc !== undefined) {
            /* `{#for await}` is the sanctioned async iterable; a sync `{#each}` is not. */
            found.push({
                loc: node.loc,
                code: node.items,
                position: node.async ? 'for await' : 'each',
            })
        }
        if ('children' in node) {
            collect(node.children, found)
        }
    }
}
