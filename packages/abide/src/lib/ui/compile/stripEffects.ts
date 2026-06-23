import ts from 'typescript'

/*
Removes `effect(...)` calls from a script for the SSR back-end. Effects are client
lifecycle — they touch the DOM / run side effects and emit no HTML, so the server
render (a snapshot of the pre-effect markup, like every framework) must not run
them. Every `effect(<args>)` call is replaced by `undefined`, dropping its body:
an `effect(() => …)` statement becomes a no-op, and a `const stop = effect(…)`
binding keeps a defined (unused) name. Client compilation keeps effects untouched.
*/
export function stripEffects(code: string): string {
    const source = ts.createSourceFile('script.ts', code, ts.ScriptTarget.Latest, true)
    const result = ts.transform(source, [stripEffectsTransformer()])
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
    const output = printer.printFile(result.transformed[0] as ts.SourceFile)
    result.dispose()
    return output
}

/* The effect-stripping as a `ts.TransformerFactory`, so the SSR script path can run it
   over the tree `lowerScript` already built (one extra print, no reparse). `stripEffects`
   is the standalone string wrapper kept for the per-nested-`<script>` SSR callers. */
export function stripEffectsTransformer(): ts.TransformerFactory<ts.SourceFile> {
    return (context) => (root) => {
        const visit = (node: ts.Node): ts.Node => {
            if (
                ts.isCallExpression(node) &&
                ts.isIdentifier(node.expression) &&
                node.expression.text === 'effect'
            ) {
                return ts.factory.createIdentifier('undefined')
            }
            return ts.visitEachChild(node, visit, context)
        }
        return ts.visitNode(root, visit) as ts.SourceFile
    }
}
