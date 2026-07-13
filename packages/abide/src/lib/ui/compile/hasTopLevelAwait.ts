import ts from 'typescript'
import { isFunctionScopeBoundary } from './isFunctionScopeBoundary.ts'

/*
True when `node` contains an `await` at its OWN top level — not nested inside any function scope
(`isFunctionScopeBoundary`: function/arrow/method/accessor/constructor). The SINGLE seed classifier
both the build lowering (`desugarSignals`: `await` present → a BLOCKING cell that suspends its render
region) and the type shadow (`compileShadow`: `$$cellValue` `T` vs `$$cellValuePending` `T | undefined`)
share, so the runtime blocking flag and the shadow type can never disagree on whether a seed is
`await`-marked (ADR-0042 D5's "one predicate"). An `await` in an inner callback / method
(`items.map(async (x) => await f(x))`, `{ async m() { await x } }`) does NOT count — only a
top-level `await` marks the seed itself.
*/
export function hasTopLevelAwait(node: ts.Node): boolean {
    let found = false
    const visit = (child: ts.Node): void => {
        if (found || isFunctionScopeBoundary(child)) {
            return
        }
        if (ts.isAwaitExpression(child)) {
            found = true
            return
        }
        ts.forEachChild(child, visit)
    }
    visit(node)
    return found
}
