import { type LiftPosition, liftAsyncSubExpressions } from './liftAsyncSubExpressions.ts'
import type { InterpolationClassifier } from './types/InterpolationClassifier.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/* A synthetic peek-cell an async (sub)expression lowers to: a unique local name, the RAW seed
   expression, its `kind` (a `promise` cell UNWRAPS to the resolved value; an `asyncIterable` cell
   tracks its latest frame), and whether the author wrote `await` (BLOCKING: joins the SSR barrier,
   resolved inline; else STREAMING: ships pending-`undefined`, resolves on the client). By kind,
   `analyzeComponent` prepends `const <name> = computed(async () => await (<code>))` (promise) or
   `const <name> = computed(<code>)` (stream); `desugarSignals` routes it (by injected name) to a
   `trackedComputed` cell read via `$$readCell(<name>)`. */
export type InjectedCell = {
    name: string
    code: string
    kind: 'promise' | 'asyncIterable'
    blocking: boolean
}

/* The result of the async-interpolation lowering: the (mutated-in-place) template plus the cells
   the lifted (sub)expressions were rewritten into (empty when none). */
export type LoweredInterpolations = { nodes: TemplateNode[]; cells: InjectedCell[] }

/*
ADR-0032 type-directed lowering of async (sub)expressions, in EVERY position — content
interpolations and value positions (attribute, `{#if}`/`{#switch}` subject, plain `{#for}` source)
alike. Each interpolation is walked (`liftAsyncSubExpressions`): a promise/`AsyncIterable`-typed
(sub)expression is lifted to an injected peek-cell and rewritten IN PLACE to a bare `__vN`
reference, so pending reads as `undefined` and composes with `??`/`?.`. A leading `await` marks the
SSR BLOCKING tier; no `await` is STREAMING. Runs even without a classifier — then only syntactic
`await`s lift (fail-open), matching the pre-classifier path for everything else.
*/
export function lowerAsyncInterpolations(
    nodes: TemplateNode[],
    classify: InterpolationClassifier | undefined,
): LoweredInterpolations {
    const counter = { n: 0 }
    const mint = (): string => `__v${counter.n++}`
    const cells: InjectedCell[] = []
    lowerList(nodes, classify, mint, cells)
    return { nodes, cells }
}

/* Lifts every async (sub)expression in a sibling list — content text parts and the node's own
   value-position expressions — rewriting each field in place, then recurses into children. */
function lowerList(
    nodes: TemplateNode[],
    classify: InterpolationClassifier | undefined,
    mint: () => string,
    cells: InjectedCell[],
): void {
    for (const node of nodes) {
        if (node.kind === 'text') {
            for (const part of node.parts) {
                if (part.kind === 'expression' && part.loc !== undefined) {
                    part.code = rewrite(part.code, part.loc, classify, mint, cells, 'content')
                }
            }
        } else if (node.kind === 'element') {
            for (const attr of node.attrs) {
                if (attr.kind === 'expression' && attr.loc !== undefined) {
                    attr.code = rewrite(attr.code, attr.loc, classify, mint, cells, 'attribute')
                } else if (attr.kind === 'interpolated') {
                    for (const part of attr.parts) {
                        if (part.kind === 'expression' && part.loc !== undefined) {
                            part.code = rewrite(
                                part.code,
                                part.loc,
                                classify,
                                mint,
                                cells,
                                'attribute',
                            )
                        }
                    }
                }
            }
        } else if (node.kind === 'if' && node.loc !== undefined) {
            const lifted = cells.length
            node.condition = rewrite(node.condition, node.loc, classify, mint, cells, 'if')
            node.asyncSubject = isBareLiftedCell(node.condition, cells, lifted)
        } else if (node.kind === 'switch' && node.loc !== undefined) {
            const lifted = cells.length
            node.subject = rewrite(node.subject, node.loc, classify, mint, cells, 'switch')
            node.asyncSubject = isBareLiftedCell(node.subject, cells, lifted)
        } else if (node.kind === 'case' && node.condition !== undefined && node.loc !== undefined) {
            /* An `{:elseif}` condition — a truthy-tested control-flow subject, lifted like an
               `{#if}` head so a bare async `{:elseif}` holds the cond-chain while it loads. */
            const lifted = cells.length
            node.condition = rewrite(node.condition, node.loc, classify, mint, cells, 'if')
            node.asyncSubject = isBareLiftedCell(node.condition, cells, lifted)
        } else if (node.kind === 'each' && node.loc !== undefined && !node.async) {
            /* A plain `{#for}` source lifts (a promise-of-iterable → empty while pending); a
               `{#for await}` source is the sanctioned `AsyncIterable`, drained by `eachAsync`
               unchanged — never lifted. */
            node.items = rewrite(node.items, node.loc, classify, mint, cells, 'each')
        }
        if ('children' in node) {
            lowerList(node.children, classify, mint, cells)
        }
    }
}

/* True when a control-flow subject's WHOLE expression was lifted to one peek-cell — the
   rewritten code is exactly a single injected name (`{#if getX()}` → `__v3`), not a compound
   the peek composes into (`{#if getX()?.ok}` → `__v3?.ok`, still the falsy-else peek). `cells`
   past index `lifted` are the ones this subject minted, so an equal name means the subject IS
   that bare cell. Only then do the back-ends read its pending facet to hold the block. */
function isBareLiftedCell(code: string, cells: InjectedCell[], lifted: number): boolean {
    const name = code.trim()
    for (let index = lifted; index < cells.length; index++) {
        if (cells[index]?.name === name) {
            return true
        }
    }
    return false
}

/* Walks one interpolation field, appends any lifted cells, and returns the rewritten expression. */
function rewrite(
    code: string,
    loc: number,
    classify: InterpolationClassifier | undefined,
    mint: () => string,
    cells: InjectedCell[],
    position: LiftPosition,
): string {
    const result = liftAsyncSubExpressions(code, loc, classify, mint, position)
    for (const lift of result.lifts) {
        cells.push(lift)
    }
    return result.code
}
