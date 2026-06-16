import ts from 'typescript'

/*
The perf pass that follows `lowerDocAccess`. Within a render scope, a static path
is read and written many times; resolving it to a node + parent + key on every
access (what `read`/`replace` do) is the path-string floor the bench measured.
This hoists each distinct static path to a `cell` bound once at the top of the
scope and rewrites accesses to the string-free `get`/`set` — the form that runs
~20x faster than re-resolving, and faster than Svelte:

  model.read("count")          →  _cell0.get()
  model.replace("count", v)    →  _cell0.set(v)
  // with, prepended once:        const _cell0 = model.cell("count")

The input is a render-scope body where `docName` is already in scope (the cell
decls are prepended to it, so the doc must exist first). Dynamic-path accesses
(`read(`a/${i}`)`) and structural ops (`add`/`remove`) are left untouched — a
cell binds one fixed scalar leaf.
*/
export function hoistCells(code: string, docName: string): string {
    const source = ts.createSourceFile('component.ts', code, ts.ScriptTarget.Latest, true)
    const cellIdForPath = new Map<string, string>()

    /* Pass 1: assign a cell id to each distinct static read/replace path. */
    const collect = (node: ts.Node): void => {
        const path = staticDocPath(node, docName, 'read') ?? staticDocPath(node, docName, 'replace')
        if (path !== undefined && !cellIdForPath.has(path)) {
            cellIdForPath.set(path, `_cell${cellIdForPath.size}`)
        }
        ts.forEachChild(node, collect)
    }
    collect(source)
    if (cellIdForPath.size === 0) {
        return code
    }

    const result = ts.transform(source, [hoistTransformer(docName, cellIdForPath)])
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
    const output = printer.printFile(result.transformed[0] as ts.SourceFile)
    result.dispose()
    return output
}

/* Returns the literal path of a `docName.method("literal", …)` call, else undefined. */
function staticDocPath(node: ts.Node, docName: string, method: string): string | undefined {
    if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === docName &&
        node.expression.name.text === method
    ) {
        const first = node.arguments[0]
        if (first !== undefined && ts.isStringLiteral(first)) {
            return first.text
        }
    }
    return undefined
}

function hoistTransformer(
    docName: string,
    cellIdForPath: Map<string, string>,
): ts.TransformerFactory<ts.SourceFile> {
    return (context) => (root) => {
        function visit(node: ts.Node): ts.Node {
            const readPath = staticDocPath(node, docName, 'read')
            if (readPath !== undefined) {
                return cellCall(cellIdForPath.get(readPath) as string, 'get', [])
            }
            const replacePath = staticDocPath(node, docName, 'replace')
            if (replacePath !== undefined) {
                const value = (node as ts.CallExpression).arguments[1]
                return cellCall(cellIdForPath.get(replacePath) as string, 'set', [
                    ts.visitNode(value, visit) as ts.Expression,
                ])
            }
            return ts.visitEachChild(node, visit, context)
        }
        const visited = ts.visitNode(root, visit) as ts.SourceFile
        const declarations = [...cellIdForPath].map(([path, id]) =>
            cellDeclaration(docName, id, path),
        )
        return ts.factory.updateSourceFile(visited, [...declarations, ...visited.statements])
    }
}

/* Builds `cellId.method(...args)`. */
function cellCall(cellId: string, method: string, args: ts.Expression[]): ts.CallExpression {
    return ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(cellId), method),
        undefined,
        args,
    )
}

/* Builds `const cellId = docName.cell("path")`. */
function cellDeclaration(docName: string, cellId: string, path: string): ts.VariableStatement {
    return ts.factory.createVariableStatement(
        undefined,
        ts.factory.createVariableDeclarationList(
            [
                ts.factory.createVariableDeclaration(
                    cellId,
                    undefined,
                    undefined,
                    ts.factory.createCallExpression(
                        ts.factory.createPropertyAccessExpression(
                            ts.factory.createIdentifier(docName),
                            'cell',
                        ),
                        undefined,
                        [ts.factory.createStringLiteral(path)],
                    ),
                ),
            ],
            ts.NodeFlags.Const,
        ),
    )
}
