import ts from 'typescript'

/*
Folds a cell-source `watch(source, handler)` into the auto-tracked thunk form
`watch(() => (handler)(source))`, so the reaction reads the cell reactively
instead of receiving a one-time value.

The plain-variable ergonomic makes a bare `count` a VALUE read everywhere the
read-lowering runs (`renameSignalRefs` → `docAccessTransformer`). That is right
for `{count}` / `count + 1`, but it also lowered `watch(count, handler)`'s source
to `$$model.read("count")` — a number — so the runtime `watch` (which expects a
`State` and reads `.value` inside an effect) never subscribed: the reaction was
inert. The `watch(count, n => …)` form was documented but silently dead.

This runs BEFORE the read-lowering, so the `source` moved inside the new thunk is
lowered to its normal reactive read there — one rewrite covers every cell kind
(doc-slot `state`, `.value` cell, `computed`, `linked`), because it reuses the
read the rest of the pipeline already emits. The runtime `watch(thunk)` is the
same auto-tracked effect the compiler's own bindings use, so semantics match the
old `effect(() => handler(cell.value))` cell branch exactly.

Only a bare cell reference (or an array literal of them — the `watch([a, b], …)`
form) is folded. A socket / rpc / arbitrary object source is left untouched so the
runtime's own source dispatch (`cache.on` / `reactToRpc`) still handles it; the
thunk (`watch(() => …)`) and rpc-with-args (`watch(fn, args, handler)`) forms are
already correct and are matched out by arity.
*/
export function wrapReactionCellSources(
    cellNames: ReadonlySet<string>,
    watchLocalNames: ReadonlySet<string>,
): ts.TransformerFactory<ts.SourceFile> {
    /* A source that names a reactive cell: a bare cell identifier, or a non-empty array
       literal whose every element is one (the multi-cell `watch([a, b], …)` form). */
    function isCellSource(source: ts.Expression): boolean {
        if (ts.isIdentifier(source)) {
            return cellNames.has(source.text)
        }
        if (ts.isArrayLiteralExpression(source)) {
            return (
                source.elements.length > 0 &&
                source.elements.every(
                    (element) => ts.isIdentifier(element) && cellNames.has(element.text),
                )
            )
        }
        return false
    }

    return (context) => (root) => {
        function visit(node: ts.Node): ts.Node {
            const [sourceArg, handlerArg] = ts.isCallExpression(node) ? node.arguments : []
            if (
                ts.isCallExpression(node) &&
                ts.isIdentifier(node.expression) &&
                watchLocalNames.has(node.expression.text) &&
                node.arguments.length === 2 &&
                sourceArg !== undefined &&
                handlerArg !== undefined &&
                isCellSource(sourceArg)
            ) {
                /* Visit the operands first — a handler body may itself contain a nested cell-source
                   watch, and the source stays a plain identifier the read-lowering rewrites next. */
                const source = ts.visitNode(sourceArg, visit) as ts.Expression
                const handler = ts.visitNode(handlerArg, visit) as ts.Expression
                /* `(handler)(source)` — parenthesise the handler so an arrow callee prints callable. */
                const call = ts.factory.createCallExpression(
                    ts.factory.createParenthesizedExpression(handler),
                    undefined,
                    [source],
                )
                const thunk = ts.factory.createArrowFunction(
                    undefined,
                    undefined,
                    [],
                    undefined,
                    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                    call,
                )
                return ts.factory.createCallExpression(node.expression, undefined, [thunk])
            }
            return ts.visitEachChild(node, visit, context)
        }
        return ts.visitNode(root, visit) as ts.SourceFile
    }
}
