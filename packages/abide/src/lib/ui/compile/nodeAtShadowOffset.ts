import ts from 'typescript'

/*
Finds the shadow AST node for a template interpolation given its span in shadow
coordinates. An interpolation is emitted as a parenthesised expression, so the
node we want starts and ends exactly on the span; we descend only into nodes that
still cover the whole span and keep the deepest exact match (the innermost node
whose `getStart()/getEnd()` equal the span bounds).
*/
export function nodeAtShadowOffset(
    sourceFile: ts.SourceFile,
    offset: number,
    length: number,
): ts.Node | undefined {
    let best: ts.Node | undefined
    const visit = (node: ts.Node): void => {
        const start = node.getStart(sourceFile)
        const end = node.getEnd()
        if (start <= offset && end >= offset + length) {
            if (start === offset && end === offset + length) {
                best = node
            }
            node.forEachChild(visit)
        }
    }
    visit(sourceFile)
    return best
}
