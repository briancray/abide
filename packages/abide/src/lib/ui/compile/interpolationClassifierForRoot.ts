import { createShadowProgram, type ShadowProgram } from './createShadowProgram.ts'
import { shadowInterpolationClassifier } from './shadowInterpolationClassifier.ts'
import type { InterpolationClassifier } from './types/InterpolationClassifier.ts'

/*
Builds the type-directed interpolation classifier for one `.abide` file, backed by
a WARM shadow program kept once per project root (ADR-0019, Stage B). The shadow
program (checker + every component's source→shadow `mappings`) is expensive to
build, so it is created lazily on first request for a root and reused for every
component in that root — the coupling that makes type-directed lowering affordable.
The incremental `createShadowLanguageService` does not expose the checker, shadow
`ts.SourceFile`, or per-file mappings publicly, so v1 uses the one-shot
`createShadowProgram` (reused per root) rather than the LS overlay path.

FAIL-OPEN throughout: if the program can't be built, or the file has no shadow, the
classifier is absent (→ today's plain-value binding); and the returned closure wraps
its whole body so ANY throw (resolution failure, missing node, checker hiccup) returns
`'sync'`. A type-resolution problem degrades to today's behavior, never breaks the build.
*/
export function interpolationClassifierForRoot(
    cache: Map<string, ShadowProgram | undefined>,
    root: string,
    abidePath: string,
): InterpolationClassifier | undefined {
    if (!cache.has(root)) {
        try {
            cache.set(root, createShadowProgram(root))
        } catch {
            cache.set(root, undefined)
        }
    }
    const shadowProgram = cache.get(root)
    if (shadowProgram === undefined) {
        return undefined
    }
    return shadowInterpolationClassifier(shadowProgram.program, shadowProgram.shadows, abidePath)
}
