import ts from 'typescript'

/*
The leaf binding names a destructuring pattern introduces, in source order —
`[a, b]` → `a, b`; `{ x, y: z }` → `x, z`; `[a, ...rest]` → `a, rest`; nested
patterns flatten. Used to re-bind an `await` `then` destructure as per-leaf
reactive reads of the resolved-value cell, so a re-settle updates each leaf in
place instead of rebuilding the branch.
*/
export function destructureBindingNames(pattern: string): string[] {
    const source = ts.createSourceFile(
        'pattern.ts',
        `const ${pattern} = $;`,
        ts.ScriptTarget.Latest,
        true,
    )
    const names: string[] = []
    const collect = (name: ts.BindingName): void => {
        if (ts.isIdentifier(name)) {
            names.push(name.text)
            return
        }
        // Object/array pattern: each element binds; array holes are OmittedExpression, not BindingElement.
        for (const element of name.elements) {
            if (ts.isBindingElement(element)) {
                collect(element.name)
            }
        }
    }
    for (const statement of source.statements) {
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                collect(declaration.name)
            }
        }
    }
    return names
}
