import ts from 'typescript'

/*
Rewrites references to a component's signal bindings into the document form the
rest of the pipeline understands: a `state` binding `count` becomes `model.count`
(data access `lowerDocAccess` then lowers to a patch/read), and a `computed`
binding `total` becomes `total.value`. Only value-position identifiers are
touched — declaration names, parameter names, and property names are collected
into a skip set first, and object shorthand (`{ count }`) is expanded to
`{ count: model.count }`. This is the bridge from the signal surface the author
writes to the patch substrate underneath.
*/
export function renameSignalRefs(
    code: string,
    stateNames: ReadonlySet<string>,
    derivedNames: ReadonlySet<string>,
    computedNames: ReadonlySet<string> = new Set(),
): string {
    const source = ts.createSourceFile('component.ts', code, ts.ScriptTarget.Latest, true)

    /* Identifier nodes that are names, not value reads — never rewritten. */
    const skip = new Set<ts.Node>()
    const collect = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node)) {
            skip.add(node.name)
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
            skip.add(node.name)
        }
        if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
            skip.add(node.name)
        }
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
            skip.add(node.name)
        }
        if (
            (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
            node.name !== undefined
        ) {
            skip.add(node.name)
        }
        ts.forEachChild(node, collect)
    }
    collect(source)

    const result = ts.transform(source, [
        (context) => (root) => {
            const visit = (node: ts.Node): ts.Node => {
                /* Shorthand `{ count }` → `{ count: model.count }` / `{ total: total.value }`. */
                if (ts.isShorthandPropertyAssignment(node)) {
                    const replacement = referenceFor(
                        node.name.text,
                        stateNames,
                        derivedNames,
                        computedNames,
                    )
                    if (replacement !== undefined) {
                        return ts.factory.createPropertyAssignment(node.name.text, replacement)
                    }
                }
                if (ts.isIdentifier(node) && !skip.has(node)) {
                    const replacement = referenceFor(
                        node.text,
                        stateNames,
                        derivedNames,
                        computedNames,
                    )
                    if (replacement !== undefined) {
                        return replacement
                    }
                }
                return ts.visitEachChild(node, visit, context)
            }
            return ts.visitNode(root, visit) as ts.SourceFile
        },
    ])
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
    const output = printer.printFile(result.transformed[0] as ts.SourceFile)
    result.dispose()
    return output
}

/* `model.<name>` for a state binding, `<name>()` for a computed doc-slot (the
   string-free reader `scope().derive` returns), `<name>.value` for a runtime cell
   (linked / lens / transform-state), else undefined. */
function referenceFor(
    name: string,
    stateNames: ReadonlySet<string>,
    derivedNames: ReadonlySet<string>,
    computedNames: ReadonlySet<string>,
): ts.Expression | undefined {
    if (stateNames.has(name)) {
        return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('model'), name)
    }
    if (computedNames.has(name)) {
        return ts.factory.createCallExpression(ts.factory.createIdentifier(name), undefined, [])
    }
    if (derivedNames.has(name)) {
        return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(name), 'value')
    }
    return undefined
}
