import ts from 'typescript'
import type { ShadowProgram } from './createShadowProgram.ts'
import { remapShadowDiagnostic } from './remapShadowDiagnostic.ts'
import type { AbideDiagnostic } from './types/AbideDiagnostic.ts'

/*
Runs the shadow program's type-checker over every `.abide` shadow and relocates
each diagnostic onto its source component. Only diagnostics that fall inside a
mapped expression survive (remapShadowDiagnostic drops shadow-internal noise);
a template that failed to parse contributes a single error at the file head.
Shared by `abide check` (one-shot render) and the LSP (per-file publish).
*/
export function collectAbideDiagnostics(shadow: ShadowProgram): AbideDiagnostic[] {
    const { program, shadows, parseErrors, abidePaths } = shadow
    const diagnostics: AbideDiagnostic[] = []
    for (const abidePath of abidePaths) {
        const parseError = parseErrors.get(abidePath)
        if (parseError !== undefined) {
            diagnostics.push({
                file: abidePath,
                start: 0,
                length: 0,
                message: parseError,
                category: ts.DiagnosticCategory.Error,
            })
            continue
        }
        const sourceFile = program.getSourceFile(`${abidePath}.ts`)
        const mappings = shadows.get(abidePath)?.mappings
        if (sourceFile === undefined || mappings === undefined) {
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
            const located = remapShadowDiagnostic(
                mappings,
                diagnostic.start,
                diagnostic.length ?? 0,
            )
            if (located === undefined) {
                continue
            }
            diagnostics.push({
                file: abidePath,
                start: located.start,
                length: located.length,
                message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
                category: diagnostic.category,
            })
        }
    }
    return diagnostics
}
