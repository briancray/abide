import ts from 'typescript'
import { NESTED_REACTIVE_BINDINGS, resolveReactiveExport } from './resolveReactiveExport.ts'
import { wrapSeed } from './wrapSeed.ts'

/*
Normalises every `state.computed(seed)` / `state.linked(seed)` in a nested branch
`<script>` so a BARE-VALUE seed becomes a thunk (`state.computed(a * 2)` →
`state.computed(() => a * 2)`), exactly as the top-level desugar (`desugarSignals` via
`wrapSeed`) does. A nested script keeps its reactive calls literal — it is not desugared to
the doc — so absent this the bare value reaches the runtime primitive, which stores it as
the compute function and calls it on read (`a * 2 is not a function`, a runtime crash). A
literal `() => …` / `function` thunk passes through unchanged, so the wrap is a no-op on the
already-thunked form the author usually writes.

Recognition is name-based (`NESTED_REACTIVE_BINDINGS`) because a nested script carries no
import of its own — it inherits the surface by the canonical `state` name, the same way
`nestedBindingNames` resolves it. Only the seed argument (`arguments[0]`) is wrapped; a
`state.linked(seed, ...)`'s trailing args pass through. Exposed as a `ts.TransformerFactory`
so the nested-script lowering can chain it ahead of the reference rename over ONE parsed tree.
*/
export function wrapReactiveSeedsTransformer(): ts.TransformerFactory<ts.SourceFile> {
    return (context) => (root) => {
        const visit = (node: ts.Node): ts.Node => {
            if (ts.isCallExpression(node) && node.arguments.length > 0) {
                const primitive = resolveReactiveExport(node.expression, NESTED_REACTIVE_BINDINGS)
                if (primitive === 'computed' || primitive === 'linked') {
                    const seed = node.arguments[0] as ts.Expression
                    const wrapped = wrapSeed(ts.visitNode(seed, visit) as ts.Expression)
                    const rest = node.arguments
                        .slice(1)
                        .map((argument) => ts.visitNode(argument, visit) as ts.Expression)
                    return ts.factory.updateCallExpression(
                        node,
                        node.expression,
                        node.typeArguments,
                        [wrapped, ...rest],
                    )
                }
            }
            return ts.visitEachChild(node, visit, context)
        }
        return ts.visitNode(root, visit) as ts.SourceFile
    }
}
