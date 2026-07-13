import ts from 'typescript'

/*
A node that opens its own (possibly async) function scope — awaits inside it are that scope's
concern, not the enclosing seed's. Both the top-level-await walk (`hasTopLevelAwait`) and the
top-level-await diagnostics stop descending here, so a seed classifies the same way a value read
inside such a scope would behave. One predicate shared by the build lowering and the type shadow so
they can never disagree on a boundary (ADR-0042 D5's "one predicate").
*/
export function isFunctionScopeBoundary(node: ts.Node): boolean {
    return (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isConstructorDeclaration(node)
    )
}
