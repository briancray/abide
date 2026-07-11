import ts from 'typescript'

/* Every identifier read as a value in `code` — excludes property member names (`.name`) and object
   literal keys, which are not free variable references. Deliberately generous elsewhere: an inner
   arrow's param is still collected, so an expression shadowing a binder name inside a callback is
   judged conservatively (NOT prefix-evaluable) rather than risking a false hoist. Shared by the
   await-flight and child-render-flight prefix-evaluability checks (ADR-0034 / ADR-0037). */
export function referencedIdentifiers(code: string): Set<string> {
    const names = new Set<string>()
    let source: ts.SourceFile
    try {
        source = ts.createSourceFile('expression.ts', code, ts.ScriptTarget.Latest, true)
    } catch {
        /* Unparseable expression → treat as non-hoistable by returning a sentinel the caller's
           binder check can never clear; simplest is a name no scope defines. */
        return new Set(['\0unparseable'])
    }
    const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node)) {
            visit(node.expression)
            return
        }
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
            visit(node.initializer)
            return
        }
        if (ts.isIdentifier(node)) {
            names.add(node.text)
            return
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    return names
}
