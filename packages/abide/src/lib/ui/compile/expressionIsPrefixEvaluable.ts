import { referencedIdentifiers } from './referencedIdentifiers.ts'

/* True when EVERY referenced identifier of `expression` is prefix-evaluable: none is a
   template-local binder and none is an async-cell name (still pending at prefix time). Over-collects
   identifiers, so any doubt fails closed. Shared by the await-flight classifier (hoistableAwaits) and
   the child-render-flight classifier (hoistableChildRenders) — a hoisted await's promise and a
   hoisted child's props must clear the same bar to start in the render prefix. */
export function expressionIsPrefixEvaluable(
    expression: string,
    binders: ReadonlySet<string>,
    cellReadNames: ReadonlySet<string>,
): boolean {
    for (const name of referencedIdentifiers(expression)) {
        if (binders.has(name) || cellReadNames.has(name)) {
            return false
        }
    }
    return true
}
