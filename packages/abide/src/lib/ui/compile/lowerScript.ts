import ts from 'typescript'
import { ABIDE_PACKAGE_NAME } from '../../shared/ABIDE_PACKAGE_NAME.ts'
import { assertTranspiles } from './assertTranspiles.ts'
import { desugarSignals } from './desugarSignals.ts'
import { identifierReferencePattern } from './identifierReferencePattern.ts'
import { docAccessTransformer } from './lowerDocAccess.ts'
import { signalRefsTransformer } from './renameSignalRefs.ts'
import { stripEffectsTransformer } from './stripEffects.ts'
import { TS_PRINTER } from './TS_PRINTER.ts'

/* The `abide/ui/*` modules the reactive surface is imported from. An author's import of
   one is compiler-recognised and lowered, so its binding is often fully consumed — a plain
   `state(...)` becomes `$$model`/`$$scope` with no `state` reference left. Such a dead
   import is dropped from the emitted module (see `deadReactiveImport`) so the output has no
   spurious static `@abide/ui` dependency — load-bearing for hot modules, which forbid one. */
const REACTIVE_IMPORT_SPECIFIERS = new Set([
    `${ABIDE_PACKAGE_NAME}/ui/state`,
    `${ABIDE_PACKAGE_NAME}/ui/effect`,
])

/* True when `statement` imports the reactive surface and none of its local bindings survive
   into the lowered output (`used` = body + ssr body) — so emitting it would be a dead,
   spurious runtime import. A binding that DOES survive (`state.share`, a bare `effect(...)`)
   keeps the import. */
function deadReactiveImport(statement: ts.ImportDeclaration, used: string): boolean {
    if (
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !REACTIVE_IMPORT_SPECIFIERS.has(statement.moduleSpecifier.text)
    ) {
        return false
    }
    const named = statement.importClause?.namedBindings
    if (named === undefined || !ts.isNamedImports(named)) {
        return false
    }
    return named.elements.every(
        (element) => !identifierReferencePattern(element.name.text).test(used),
    )
}

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

export function lowerScript(
    scriptBody: string,
    /* Reactive-surface identifiers referenced OUTSIDE this script — the nested branch
       `<script>`s, which keep their `state.computed(...)` calls literal and so still need
       the module-level import even after the leading script's own `state(...)` all
       desugared away. Folded into the dead-import usage check so a live import isn't dropped
       (→ `ReferenceError: state is not defined` in the branch). Empty for a nested script. */
    externalUsage = '',
    /* Names of synthetic `const __cN = computed(...)` cells `analyzeComponent` prepended for
       asyncIterable interpolations (ADR-0019 Stage D). `computed` here is an unimported callee,
       so `desugarSignals` recognizes these declarations by name — routing each to an eager
       `trackedComputed` stream cell — rather than by import resolution. Empty on every other path. */
    injectedCellNames: ReadonlySet<string> = new Set(),
    /* Names the template writes/forwards (`writtenTemplateNames`), so a `props()` binding used
       two-way is desugared to a writable cell rather than a read-only derive. Empty for a nested
       script (which declares no props). */
    templateWrittenNames: ReadonlySet<string> = new Set(),
): {
    body: string
    imports: string
    ssrBody: string
    stateNames: Set<string>
    derivedNames: Set<string>
    computedNames: Set<string>
    cellReadNames: Set<string>
    droppedReactiveImports: Set<string>
} {
    const source = ts.createSourceFile('component.ts', scriptBody, ts.ScriptTarget.Latest, true)
    const { transformer, stateNames, derivedNames, computedNames, cellReadNames } = desugarSignals(
        source,
        injectedCellNames,
        templateWrittenNames,
    )
    const result = ts.transform(source, [
        transformer,
        signalRefsTransformer(
            stateNames,
            derivedNames,
            computedNames,
            new Set(),
            new Set(),
            cellReadNames,
        ),
        docAccessTransformer('$$model'),
    ])
    const transformed = result.transformed[0] as ts.SourceFile
    /* Top-level imports must live at module scope, not inside the mount/render
       function the script body becomes — hoist them off the tree. */
    const importStatements = transformed.statements.filter(ts.isImportDeclaration)
    const bodyStatements = transformed.statements.filter(
        (statement) => !ts.isImportDeclaration(statement),
    )
    const bodyFile = ts.factory.updateSourceFile(transformed, bodyStatements)
    const body = TS_PRINTER.printFile(bodyFile).trim()
    /* The SSR variant strips client-only `effect(...)` calls — run over the SAME lowered
       tree (one extra transform + print, no reparse) instead of re-parsing the printed
       script downstream. */
    const ssrResult = ts.transform(bodyFile, [stripEffectsTransformer()])
    const ssrBody = TS_PRINTER.printFile(ssrResult.transformed[0] as ts.SourceFile).trim()
    ssrResult.dispose()
    result.dispose()
    /* Drop reactive-surface imports fully consumed by lowering — keeping them would leave a
       dead, spurious `@abide/ui` runtime dependency (checked against both back-ends' output). */
    const used = `${body}\n${ssrBody}\n${externalUsage}`
    const droppedReactiveImports = new Set<string>()
    const imports = importStatements
        .filter((statement) => {
            if (!deadReactiveImport(statement, used)) {
                return true
            }
            /* Record the local names of a dropped reactive import so the module wrapper can
               independently confirm the drop stranded no live reference. */
            const named = statement.importClause?.namedBindings
            if (named !== undefined && ts.isNamedImports(named)) {
                for (const element of named.elements) {
                    droppedReactiveImports.add(element.name.text)
                }
            }
            return false
        })
        .map((statement) => TS_PRINTER.printNode(ts.EmitHint.Unspecified, statement, transformed))
        .join('\n')

    assertTranspiles(
        [imports, body].filter((part) => part !== '').join('\n'),
        'component script lowering',
    )
    return {
        body,
        imports,
        ssrBody,
        stateNames,
        derivedNames,
        computedNames,
        cellReadNames,
        droppedReactiveImports,
    }
}
