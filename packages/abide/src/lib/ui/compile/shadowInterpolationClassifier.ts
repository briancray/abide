import type ts from 'typescript'
import { classifyInterpolationType } from './classifyInterpolationType.ts'
import { nodeAtShadowOffset } from './nodeAtShadowOffset.ts'
import { shadowNaming } from './shadowNaming.ts'
import { sourceToShadowOffset } from './sourceToShadowOffset.ts'
import type { CompiledShadow } from './types/CompiledShadow.ts'
import type { InterpolationClassifier } from './types/InterpolationClassifier.ts'

/*
Builds the type-directed interpolation classifier for one `.abide` file against an already-built
shadow `program` (its `shadows` map carries each file's source→shadow `mappings`). Given an
interpolation's absolute source offset and text, it maps into shadow coordinates, finds the emitted
expression node, and reads its checker type — the shared core behind both `interpolationClassifier
ForRoot` (the runtime lowering, over `createShadowProgram`) and the type-check shadow's own peek-wrap
(over the check/LSP program). The classifier reads a VERBATIM shadow — one whose interpolations were
NOT peek-wrapped — so `getFoo()` still types as `Promise<…>` and classifies as `promise`.

FAIL-OPEN: no shadow file for the path ⇒ `undefined` (caller degrades to no wrap / plain binding);
the returned closure wraps its body so ANY throw (missing node, checker hiccup) returns `'sync'`.
*/
export function shadowInterpolationClassifier(
    program: ts.Program,
    shadows: Map<string, CompiledShadow>,
    abidePath: string,
): InterpolationClassifier | undefined {
    const shadowFile = program.getSourceFile(shadowNaming.suffixed(abidePath))
    if (shadowFile === undefined) {
        return undefined
    }
    const checker = program.getTypeChecker()
    const mappings = shadows.get(abidePath)?.mappings ?? []
    return (loc, code) => {
        try {
            const offset = sourceToShadowOffset(mappings, loc)
            if (offset === undefined) {
                return 'sync'
            }
            const node = nodeAtShadowOffset(shadowFile, offset, code.length)
            if (node === undefined) {
                return 'sync'
            }
            return classifyInterpolationType(checker.getTypeAtLocation(node), node, checker)
        } catch {
            return 'sync'
        }
    }
}
