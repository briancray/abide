import ts from 'typescript'
import { collectAbideDiagnostics } from './lib/ui/compile/collectAbideDiagnostics.ts'
import { createShadowProgram } from './lib/ui/compile/createShadowProgram.ts'
import type { AbideDiagnostic } from './lib/ui/compile/types/AbideDiagnostic.ts'

/*
Type-checks every `.abide` component in `cwd` through its shadow (ADR-0010) and
prints the diagnostics against the source files with a code frame — the
`svelte-check` analog. Returns the error count so the CLI can set its exit code.
*/
export async function checkAbide({ cwd }: { cwd: string }): Promise<number> {
    const diagnostics = collectAbideDiagnostics(createShadowProgram(cwd))
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
