import ts from 'typescript'
import { asyncValuePositionError } from './asyncValuePositionError.ts'
import { asyncValuePositionInterpolations } from './asyncValuePositionInterpolations.ts'
import { classifyInterpolationType } from './classifyInterpolationType.ts'
import type { ShadowProgram } from './createShadowProgram.ts'
import { nodeAtShadowOffset } from './nodeAtShadowOffset.ts'
import { parseTemplate } from './parseTemplate.ts'
import { remapShadowDiagnostic } from './remapShadowDiagnostic.ts'
import { sourceToShadowOffset } from './sourceToShadowOffset.ts'
import type { AbideDiagnostic } from './types/AbideDiagnostic.ts'
import type { ShadowMapping } from './types/CompiledShadow.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/*
Runs the shadow program's type-checker over every `.abide` shadow and relocates
each diagnostic onto its source component. Only diagnostics that fall inside a
mapped expression survive (remapShadowDiagnostic drops shadow-internal noise);
a template that failed to parse contributes a single error at the file head.
Shared by `abide check` (one-shot render) and the LSP (per-file publish).
*/
export function collectAbideDiagnostics(shadow: ShadowProgram): AbideDiagnostic[] {
    const { program, shadows, parseErrors, abidePaths } = shadow
    const checker = program.getTypeChecker()
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
        /* Shadow-raised author rules (e.g. importing a compiler-internal helper) are
           already in source coordinates — emit them directly, no segment remap. */
        for (const diagnostic of shadows.get(abidePath)?.diagnostics ?? []) {
            diagnostics.push({
                file: abidePath,
                start: diagnostic.start,
                length: diagnostic.length,
                message: diagnostic.message,
                category: ts.DiagnosticCategory.Error,
            })
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
        /* Stage E parity (ADR-0019): the build front-end (`lowerAsyncInterpolations`) throws on a
           promise/asyncIterable in a NON-content value position; mirror it here as a diagnostic so
           `abide check`/the LSP surface the same error. The shadow already type-checks these
           spans, so their offsets map through the same `mappings`; classify each against the
           checker and emit an Error for any async value the guard rejects. */
        collectValuePositionDiagnostics(abidePath, sourceFile, mappings, checker, diagnostics)
    }
    return diagnostics
}

/* Parses the component template, walks its value-position interpolations, and pushes a diagnostic
   for any promise/asyncIterable the Stage E guard rejects. Classifies via the shadow: map the
   expression's source offset into shadow coordinates, find its emitted expression node, read its
   checker type. Fail-open — an unparseable template or unmappable span contributes nothing, so a
   type hiccup degrades to no extra diagnostic instead of throwing. */
function collectValuePositionDiagnostics(
    abidePath: string,
    shadowFile: ts.SourceFile,
    mappings: ShadowMapping[],
    checker: ts.TypeChecker,
    diagnostics: AbideDiagnostic[],
): void {
    const source = ts.sys.readFile(abidePath)
    if (source === undefined) {
        return
    }
    /* The template starts just past the leading `<script>` — the SAME base `compileShadow` parses
       from, so each interpolation's `loc` lines up with the shadow's source→shadow `mappings`. */
    const leadingScript = source.match(/^\s*<script[^>]*>([\s\S]*?)<\/script>/)
    const templateStart = leadingScript ? (leadingScript.index ?? 0) + leadingScript[0].length : 0
    let nodes: TemplateNode[]
    try {
        nodes = parseTemplate(source.slice(templateStart), templateStart).nodes
    } catch {
        return
    }
    for (const interpolation of asyncValuePositionInterpolations(nodes)) {
        const shadowOffset = sourceToShadowOffset(mappings, interpolation.loc)
        if (shadowOffset === undefined) {
            continue
        }
        const node = nodeAtShadowOffset(shadowFile, shadowOffset, interpolation.code.length)
        if (node === undefined) {
            continue
        }
        const kind = classifyInterpolationType(checker.getTypeAtLocation(node), node, checker)
        const message = asyncValuePositionError(kind, interpolation.position)
        if (message !== undefined) {
            diagnostics.push({
                file: abidePath,
                start: interpolation.loc,
                length: interpolation.code.length,
                message,
                category: ts.DiagnosticCategory.Error,
            })
        }
    }
}
