import ts from 'typescript'

/* Top-level declared names of a code block — a nested `<script>`'s locals, or a snippet's params
   parsed as a destructuring pattern. Best-effort; on a parse miss returns empty (fail-open on the
   binder side is safe: a script's names only ADD conservatism to a prefix-evaluability check when
   present). Shared by the await-flight and child-render-flight classifiers (ADR-0034 / ADR-0037). */
export function declaredNames(code: string): Set<string> {
    const names = new Set<string>()
    let source: ts.SourceFile
    try {
        source = ts.createSourceFile('script.ts', code, ts.ScriptTarget.Latest, true)
    } catch {
        return names
    }
    const collectBinding = (name: ts.BindingName): void => {
        if (ts.isIdentifier(name)) {
            names.add(name.text)
            return
        }
        for (const element of name.elements) {
            if (ts.isBindingElement(element)) {
                collectBinding(element.name)
            }
        }
    }
    for (const statement of source.statements) {
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                collectBinding(declaration.name)
            }
        } else if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
            names.add(statement.name.text)
        }
    }
    return names
}
