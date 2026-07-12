import { asyncInterpolationFields } from './asyncInterpolationFields.ts'
import { liftAsyncSubExpressions } from './liftAsyncSubExpressions.ts'
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

/* Lifts every async (sub)expression in a sibling list, then recurses into children. Each node's
   async-liftable fields come from the shared `asyncInterpolationFields` plan (the single reading the
   shadow front-end also drives from), so the two can't disagree on which interpolations are async;
   this side owns the RENDERING — lift the field to a peek-cell, write the `__vN` reference back, and
   for a control-flow subject that collapsed to one bare cell mark `asyncSubject`. */
function lowerList(
    nodes: TemplateNode[],
    classify: InterpolationClassifier | undefined,
    mint: () => string,
    cells: InjectedCell[],
): void {
    for (const node of nodes) {
        for (const field of asyncInterpolationFields(node)) {
            const lifted = cells.length
            const result = liftAsyncSubExpressions(
                field.code,
                field.loc,
                classify,
                mint,
                field.position,
            )
            for (const lift of result.lifts) {
                cells.push(lift)
            }
            field.write(result.code)
            if (field.subject) {
                field.setAsyncSubject(isBareLiftedCell(result.code, cells, lifted))
            }
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
