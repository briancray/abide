import ts from 'typescript'
import { assertTranspiles } from './assertTranspiles.ts'
import { desugarSignals } from './desugarSignals.ts'
import { docAccessTransformer } from './lowerDocAccess.ts'
import { signalRefsTransformer } from './renameSignalRefs.ts'

/*
The component-script lowering, done in ONE parse. The script is parsed once, then
`desugarSignals` (signal declarations → `model` slots / `scope().derive`), reference
renaming (`count` → `model.count`), and doc-access lowering (`model.count` → patch/read)
run as a chained `ts.transform` over the SAME tree — each as a standalone string pass
would parse + reprint. desugar returns a transformer rather than rebuilt source text
precisely so it can chain here; the name sets it collects feed the rename transformer.

Imports are partitioned off the transformed tree structurally (`ts.isImportDeclaration`),
not by regex, so a multi-line import hoists correctly regardless of formatting. The
reassembled output is transpiled as a fail-loud guard: if a future un-handled rewrite
position corrupts the script (the failure mode the syntax fuzz corpus also guards), it
surfaces here as a located compile error instead of shipping a broken bundle.
*/

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })

export function lowerScript(scriptBody: string): {
    body: string
    imports: string
    stateNames: Set<string>
    derivedNames: Set<string>
    computedNames: Set<string>
} {
    const source = ts.createSourceFile('component.ts', scriptBody, ts.ScriptTarget.Latest, true)
    const { transformer, stateNames, derivedNames, computedNames } = desugarSignals(source)
    const result = ts.transform(source, [
        transformer,
        signalRefsTransformer(stateNames, derivedNames, computedNames),
        docAccessTransformer('model'),
    ])
    const transformed = result.transformed[0] as ts.SourceFile
    /* Top-level imports must live at module scope, not inside the mount/render
       function the script body becomes — hoist them off the tree. */
    const importStatements = transformed.statements.filter(ts.isImportDeclaration)
    const bodyStatements = transformed.statements.filter(
        (statement) => !ts.isImportDeclaration(statement),
    )
    const imports = importStatements
        .map((statement) => printer.printNode(ts.EmitHint.Unspecified, statement, transformed))
        .join('\n')
    const body = printer.printFile(ts.factory.updateSourceFile(transformed, bodyStatements)).trim()
    result.dispose()

    assertTranspiles(
        [imports, body].filter((part) => part !== '').join('\n'),
        'component script lowering',
    )
    return { body, imports, stateNames, derivedNames, computedNames }
}
