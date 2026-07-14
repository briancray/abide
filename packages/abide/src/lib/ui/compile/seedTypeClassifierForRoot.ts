import { cachedShadowProgram } from './cachedShadowProgram.ts'
import { classifyInterpolationType } from './classifyInterpolationType.ts'
import type { ShadowProgram } from './createShadowProgram.ts'
import { nodeAtShadowOffset } from './nodeAtShadowOffset.ts'
import { shadowNaming } from './shadowNaming.ts'
import { sourceToShadowOffset } from './sourceToShadowOffset.ts'
import type { SeedTypeClassifier } from './types/SeedTypeClassifier.ts'

/*
Builds the type-directed SEED classifier for one `.abide` file (ADR-0023) — the cell
transform's counterpart to `interpolationClassifierForRoot`, resolving a `computed`/`linked`
seed's checker type through the SAME warm shadow program (kept once per project root, ADR-0019
Stage B). Shares the `cache` the interpolation classifier populates, so no second program is
built: whichever classifier is requested first for a root warms it, the other reuses it.

A `computed(SEED)` declaration is emitted into the shadow's script region with `SEED` wrapped
in parens (verbatim if the callee is unrecognized, or projected as `(SEED)()` when recognized
as `state.computed` — either way the seed sub-expression maps back to source and resolves its
own type), so the identical `sourceToShadowOffset → nodeAtShadowOffset → classifyInterpolation
Type` pipeline the interpolation half uses resolves a seed with no node-finder variant.

FAIL-OPEN, but NOT to `'sync'`: if the program can't build (warned once per root by
`cachedShadowProgram`), the file has no shadow, the seed's location doesn't map, no node is
found, or the checker throws, the classifier is absent / returns `undefined` — the signal the
caller reads as "degrade to `isBareCallComputed`", NOT as "the seed is sync". Collapsing failure
to `'sync'` (as the interpolation classifier does) would mis-route a failed stream seed to the
lazy `derive` slot instead of today's syntax heuristic.
*/
export function seedTypeClassifierForRoot(
    cache: Map<string, ShadowProgram | undefined>,
    root: string,
    abidePath: string,
): SeedTypeClassifier | undefined {
    const shadowProgram = cachedShadowProgram(cache, root)
    if (shadowProgram === undefined) {
        return undefined
    }
    const { program, shadows } = shadowProgram
    const shadowFile = program.getSourceFile(shadowNaming.suffixed(abidePath))
    if (shadowFile === undefined) {
        return undefined
    }
    const checker = program.getTypeChecker()
    return (loc, code) => {
        try {
            const mappings = shadows.get(abidePath)?.mappings ?? []
            const offset = sourceToShadowOffset(mappings, loc)
            if (offset === undefined) {
                return undefined
            }
            const node = nodeAtShadowOffset(shadowFile, offset, code.length)
            if (node === undefined) {
                return undefined
            }
            return classifyInterpolationType(checker.getTypeAtLocation(node), node, checker)
        } catch {
            return undefined
        }
    }
}
