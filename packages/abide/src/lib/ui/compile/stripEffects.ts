import ts from 'typescript'
import { TS_PRINTER } from './TS_PRINTER.ts'

/*
Removes effect/watch reaction calls from a script for the SSR back-end. Reactions are
client lifecycle — they touch the DOM / run side effects and emit no HTML, so the server
render (a snapshot of the pre-effect markup, like every framework) must not run
them. Stripped: the bare `effect(<args>)` and its authored scope form
`scope().effect(<args>)` / `c.effect(<args>)`, and the bare reaction `watch(<args>)`
(its replacement) — each replaced by `undefined`, so an `effect(() => …)` /
`watch(src, …)` statement becomes a no-op and a `const stop = watch(…)` binding keeps a
defined (unused) name. `watch` matches bare only (never a member — unlike the legacy
`.effect` scope method — so an unrelated `x.watch(...)` is untouched). Client
compilation keeps reactions untouched.
*/
export function stripEffects(code: string): string {
    const source = ts.createSourceFile('script.ts', code, ts.ScriptTarget.Latest, true)
    const result = ts.transform(source, [stripEffectsTransformer()])
    const output = TS_PRINTER.printFile(result.transformed[0] as ts.SourceFile)
    result.dispose()
    return output
}

/* The effect-stripping as a `ts.TransformerFactory`, so the SSR script path can run it
   over the tree `lowerScript` already built (one extra print, no reparse). `stripEffects`
   is the standalone string wrapper kept for the per-nested-`<script>` SSR callers. */
export function stripEffectsTransformer(): ts.TransformerFactory<ts.SourceFile> {
    return (context) => (root) => {
        const visit = (node: ts.Node): ts.Node => {
            if (ts.isCallExpression(node) && isEffectCallee(node.expression)) {
                return ts.factory.createIdentifier('undefined')
            }
            return ts.visitEachChild(node, visit, context)
        }
        return ts.visitNode(root, visit) as ts.SourceFile
    }
}

/* A reaction callee to strip: the bare runtime helpers (`effect` / `watch`) or the
   scope-method form (`scope().effect`, `c.effect`). Receiver-agnostic on the `.effect`
   member name (effect was a scope primitive); `watch` matches bare only, so an unrelated
   `x.watch(...)` member call is left intact. */
function isEffectCallee(expression: ts.Expression): boolean {
    if (ts.isIdentifier(expression)) {
        return expression.text === 'effect' || expression.text === 'watch'
    }
    return ts.isPropertyAccessExpression(expression) && expression.name.text === 'effect'
}
