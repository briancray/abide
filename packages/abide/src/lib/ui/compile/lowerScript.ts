import ts from 'typescript'
import { ABIDE_PACKAGE_NAME } from '../../shared/ABIDE_PACKAGE_NAME.ts'
import { assertTranspiles } from './assertTranspiles.ts'
import { desugarSignals } from './desugarSignals.ts'
import { identifierReferencePattern } from './identifierReferencePattern.ts'
import { docAccessTransformer } from './lowerDocAccess.ts'
import { signalRefsTransformer } from './renameSignalRefs.ts'
import { reactiveImportBindings } from './resolveReactiveExport.ts'
import { stripEffectsTransformer } from './stripEffects.ts'
import { TS_PRINTER } from './TS_PRINTER.ts'
import type { SeedTypeClassifier } from './types/SeedTypeClassifier.ts'
import { wrapReactionCellSources } from './wrapReactionCellSources.ts'

/* The `abide/ui/*` modules the reactive surface is imported from. An author's import of
   one is compiler-recognised and lowered, so its binding is often fully consumed — a plain
   `state(...)` becomes `$$model`/`$$scope` with no `state` reference left. Such a dead
   import is dropped from the emitted module (see `deadReactiveImport`) so the output carries
   no spurious static `@abide/ui` dependency — a dead import a bundler would still resolve. */
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
    /* The subset of `injectedCellNames` whose author wrote `await` (ADR-0032): a BLOCKING peek-cell
       that joins the SSR barrier (resolved inline), vs a streaming one that ships pending. Threaded
       to `desugarSignals` so `injectedComputedStatements` passes the right `trackedComputed`
       streaming flag. Empty on every other path. */
    blockingCellNames: ReadonlySet<string> = new Set(),
    /* Names the template writes/forwards (`writtenTemplateNames`), so a `props()` binding used
       two-way is desugared to a writable cell rather than a read-only derive. Empty for a nested
       script (which declares no props). */
    templateWrittenNames: ReadonlySet<string> = new Set(),
    /* Type-directed seed classifier + this script's absolute source base (ADR-0023), threaded
       to `desugarSignals` so a no-marker `computed(seed)` routes on the seed's checker type.
       Absent ⇒ fail-open to the `isBareCallComputed` syntax heuristic (today's behavior). */
    seedClassify?: SeedTypeClassifier,
    scriptBase = 0,
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
        blockingCellNames,
        templateWrittenNames,
        seedClassify,
        scriptBase,
    )
    /* The local names bound to `watch` (alias-safe), and the full set of read-rewritten cell
       names — together they let `wrapReactionCellSources` fold a `watch(cell, handler)` into
       the thunk form BEFORE the read-lowering turns the cell reference into a value read. */
    const watchLocalNames = new Set<string>()
    for (const [local, canonical] of reactiveImportBindings(source).direct) {
        if (canonical === 'watch') {
            watchLocalNames.add(local)
        }
    }
    const cellNames = new Set<string>([
        ...stateNames,
        ...derivedNames,
        ...computedNames,
        ...cellReadNames,
    ])
    /* `wrapReactionCellSources` only folds `watch(cell, …)` calls, so it's a pure
       identity walk when the script imports no `watch` (the common case) — skip the
       extra full-tree pass entirely then. */
    const reactionTransforms =
        watchLocalNames.size > 0 ? [wrapReactionCellSources(cellNames, watchLocalNames)] : []
    const result = ts.transform(source, [
        transformer,
        ...reactionTransforms,
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
