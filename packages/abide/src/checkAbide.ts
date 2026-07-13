import { resolve } from 'node:path'
import ts from 'typescript'
import { generateDeclarations } from './lib/shared/generateDeclarations.ts'
import { collectAbideDiagnostics } from './lib/ui/compile/collectAbideDiagnostics.ts'
import { createShadowProgram, type ShadowProgram } from './lib/ui/compile/createShadowProgram.ts'
import { interpolationClassifierForRoot } from './lib/ui/compile/interpolationClassifierForRoot.ts'
import { nearestProjectRoot } from './lib/ui/compile/nearestProjectRoot.ts'
import type { AbideDiagnostic } from './lib/ui/compile/types/AbideDiagnostic.ts'

/*
Type-checks every `.abide` component in `cwd` through its shadow (ADR-0010) and
prints the diagnostics against the source files with a code frame — a
component type-check pass. Each component is grouped under its nearest tsconfig and
checked against that project's options, so a monorepo checked at its root reports
the same as each package checked on its own — and the same as the LSP. Returns
the error count so the CLI can set its exit code.
*/
export async function checkAbide({ cwd }: { cwd: string }): Promise<number> {
    /* Materialize the project's generated augmentations (src/.abide/*.d.ts) first: since the
       check pass now type-checks the project's `.ts` files too (rpc handlers, app.ts, tests),
       those resolve `app.rpc.<name>` / typed `url('/rpc/…')` off the build-written RpcClient /
       RpcRoutes augmentations. Without this, a cold `abide check` (CI, fresh clone — `.abide` is
       gitignored, generated only by dev/build) reports every augmented member as missing. Fails
       open, so a codegen hiccup degrades to the pre-`.ts`-check behaviour rather than aborting. */
    await generateDeclarations({ cwd })
    const { diagnostics, checked } = collectByProject(cwd)
    const byFile = new Map<string, AbideDiagnostic[]>()
    for (const diagnostic of diagnostics) {
        const bucket = byFile.get(diagnostic.file) ?? []
        bucket.push(diagnostic)
        byFile.set(diagnostic.file, bucket)
    }

    for (const [file, fileDiagnostics] of byFile) {
        const text = (await Bun.file(file).text()).replaceAll('\r\n', '\n')
        for (const diagnostic of fileDiagnostics.toSorted((a, b) => a.start - b.start)) {
            printDiagnostic(file, text, diagnostic)
        }
    }

    const errors = diagnostics.filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    ).length
    /* Success reports components *checked* (the glob count); failure reports the
       files *with* errors. Reporting `byFile.size` on success printed `0` — it only
       holds files that had diagnostics. */
    const fileCount = byFile.size
    console.log(
        errors === 0
            ? `\n[abide check] no type errors in ${checked} component${checked === 1 ? '' : 's'}`
            : `\n[abide check] ${errors} error${errors === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}`,
    )
    return errors
}

/* Groups every `.abide` under `cwd` by its nearest tsconfig and type-checks each
   project's components against that project's options, then concatenates the
   diagnostics. Imported components from another project resolve on demand through
   the host, so the per-project root set stays each project's own files. */
function collectByProject(cwd: string): { diagnostics: AbideDiagnostic[]; checked: number } {
    const byProject = new Map<string, string[]>()
    for (const relative of new Bun.Glob('**/*.abide').scanSync({ cwd, onlyFiles: true })) {
        if (relative.includes('node_modules')) {
            continue
        }
        const path = resolve(cwd, relative)
        const root = nearestProjectRoot(path, cwd)
        byProject.set(root, [...(byProject.get(root) ?? []), path])
    }
    /* Per-root cache of the VERBATIM classifier program (ADR-0032). The type-check pass peek-wraps
       async interpolations so they resolve to their settled value, but the classifier that decides
       WHICH sub-expressions are async must read un-wrapped shadows — so it rides a separate verbatim
       program, built (and reused) here per root. */
    const classifierCache = new Map<string, ShadowProgram | undefined>()
    const diagnostics = [...byProject].flatMap(([root, paths]) => {
        const shadow = createShadowProgram(root, paths, (abidePath) =>
            interpolationClassifierForRoot(classifierCache, root, abidePath),
        )
        /* The shadow program already holds the project's real `.ts` files (loaded so the
           components' imports/types resolve), but `collectAbideDiagnostics` only reports the
           `.abide` shadows. Report the `.ts` files too, so a mistyped `navigate`/`url`/`patch`
           call — or any type error — in an rpc handler, `app.ts`, or a `$shared` helper fails
           `abide check` instead of only surfacing under a separately-run `tsc`. */
        return [...collectAbideDiagnostics(shadow), ...collectTsDiagnostics(shadow.program)]
    })
    const checked = [...byProject.values()].reduce((total, paths) => total + paths.length, 0)
    return { diagnostics, checked }
}

/* Syntactic + semantic diagnostics for the project's own `.ts` files already in the shadow
   program. Iterating the ROOT file names (the project's tsconfig inputs) — not every loaded
   source — scopes this to the project itself: an on-demand-resolved import from node_modules or a
   monorepo sibling is in the program but never a root, so its errors aren't attributed here.
   `fileExists` drops the virtual `.abide.ts` shadows and the synthetic asset-modules file (neither
   is on disk), `isDeclarationFile` drops the default libs and the generated `src/.abide/*.d.ts`,
   and the `.ts`/`.tsx` guard drops raw `.abide` root entries. Real source coordinates — no remap. */
function collectTsDiagnostics(program: ts.Program): AbideDiagnostic[] {
    const diagnostics: AbideDiagnostic[] = []
    for (const rootName of program.getRootFileNames()) {
        if (
            (!rootName.endsWith('.ts') && !rootName.endsWith('.tsx')) ||
            rootName.includes('/node_modules/') ||
            !ts.sys.fileExists(rootName)
        ) {
            continue
        }
        const sourceFile = program.getSourceFile(rootName)
        if (sourceFile === undefined || sourceFile.isDeclarationFile) {
            continue
        }
        const raw = [
            ...program.getSyntacticDiagnostics(sourceFile),
            ...program.getSemanticDiagnostics(sourceFile),
        ]
        for (const diagnostic of raw) {
            if (diagnostic.start === undefined) {
                continue
            }
            diagnostics.push({
                file: sourceFile.fileName,
                start: diagnostic.start,
                length: diagnostic.length ?? 0,
                message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
                category: diagnostic.category,
            })
        }
    }
    return diagnostics
}

/* Renders one diagnostic as `path:line:col severity message` plus the offending
   line and a caret underline spanning the mapped range. */
function printDiagnostic(file: string, text: string, diagnostic: AbideDiagnostic): void {
    const before = text.slice(0, diagnostic.start)
    const lineNumber = before.split('\n').length
    const column = diagnostic.start - (before.lastIndexOf('\n') + 1)
    const lineText = text.split('\n')[lineNumber - 1] ?? ''
    const severity = diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning'
    const gutter = String(lineNumber)
    console.log(`\n${file}:${lineNumber}:${column + 1} ${severity}  ${diagnostic.message}`)
    console.log(`  ${gutter} | ${lineText}`)
    console.log(
        `  ${' '.repeat(gutter.length)} | ${' '.repeat(column)}${'^'.repeat(Math.max(1, diagnostic.length))}`,
    )
}
