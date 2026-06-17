import { resolve } from 'node:path'
import ts from 'typescript'
import { collectAbideDiagnostics } from './lib/ui/compile/collectAbideDiagnostics.ts'
import { createShadowProgram } from './lib/ui/compile/createShadowProgram.ts'
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
    const diagnostics = collectByProject(cwd)
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
    const relative = byFile.size
    console.log(
        errors === 0
            ? `\n[abide check] no type errors in ${relative} component${relative === 1 ? '' : 's'}`
            : `\n[abide check] ${errors} error${errors === 1 ? '' : 's'} in ${relative} file${relative === 1 ? '' : 's'}`,
    )
    return errors
}

/* Groups every `.abide` under `cwd` by its nearest tsconfig and type-checks each
   project's components against that project's options, then concatenates the
   diagnostics. Imported components from another project resolve on demand through
   the host, so the per-project root set stays each project's own files. */
function collectByProject(cwd: string): AbideDiagnostic[] {
    const byProject = new Map<string, string[]>()
    for (const relative of new Bun.Glob('**/*.abide').scanSync({ cwd, onlyFiles: true })) {
        if (relative.includes('node_modules')) {
            continue
        }
        const path = resolve(cwd, relative)
        const root = nearestProjectRoot(path, cwd)
        byProject.set(root, [...(byProject.get(root) ?? []), path])
    }
    return [...byProject].flatMap(([root, paths]) =>
        collectAbideDiagnostics(createShadowProgram(root, paths)),
    )
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
