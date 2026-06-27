import ts from 'typescript'

/*
Rewrites a value-position bare identifier `children` to `$props?.$children` — the
reserved slot reader behind `{#if children}` (and any other expression naming
`children`). `{children()}` itself is a slot NODE handled in the parser, not here.
Property names (`x.children`, `{ children: … }`) are left untouched; only standalone
value reads are rewritten. Optional chaining (`?.`) guards a component invoked with no
props. `children` is reserved (declaring it is a compile error), so no shadow tracking
is needed.
*/
export function childrenRefTransformer(): ts.TransformerFactory<ts.SourceFile> {
    return (context) => (root) => {
        const visit: ts.Visitor = (node) => {
            /* `obj.children` — recurse the object, keep the property name. */
            if (ts.isPropertyAccessExpression(node)) {
                return ts.factory.updatePropertyAccessExpression(
                    node,
                    ts.visitNode(node.expression, visit) as ts.Expression,
                    node.name,
                )
            }
            /* `{ children: value }` — keep the key, visit the value. */
            if (ts.isPropertyAssignment(node)) {
                return ts.factory.updatePropertyAssignment(
                    node,
                    node.name,
                    ts.visitNode(node.initializer, visit) as ts.Expression,
                )
            }
            /* `{ children }` shorthand — leave as-is (the reserved name is not a local). */
            if (ts.isShorthandPropertyAssignment(node)) {
                return node
            }
            /* Bare value-position `children` → `$props?.$children`. */
            if (ts.isIdentifier(node) && node.text === 'children') {
                return ts.factory.createPropertyAccessChain(
                    ts.factory.createIdentifier('$props'),
                    ts.factory.createToken(ts.SyntaxKind.QuestionDotToken),
                    ts.factory.createIdentifier('$children'),
                )
            }
            return ts.visitEachChild(node, visit, context)
        }
        return ts.visitNode(root, visit) as ts.SourceFile
    }
}
