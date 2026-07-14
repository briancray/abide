import { analyzeComponent } from './analyzeComponent.ts'
import { generateBuild } from './generateBuild.ts'
import { hoistCells } from './hoistCells.ts'
import type { AnalyzedComponent } from './types/AnalyzedComponent.ts'
import type { InterpolationClassifier } from './types/InterpolationClassifier.ts'
import type { SeedTypeClassifier } from './types/SeedTypeClassifier.ts'

/*
Compiles a single-file abide component into the body of a client build function.
Runs the shared front-end (`analyzeComponent`), generates the DOM build from the
template, and hoists static paths to cells. The returned body operates on `host`
with the `$$`-prefixed dom bindings and `$$model` in scope (the latter emitted by
`desugarSignals`). `compileModule` wraps it (and the SSR body) into
a real module; tests wrap it with `new Function`.

`analyzed` is a lazy default: a direct caller (tests) omits it and the front-end
runs here, but `compileModule` analyzes once and passes the result to both
back-ends, so the shared front-end runs once per build instead of three times.
*/
export function compileComponent(
    source: string,
    isLayout = false,
    scopeSeed?: string,
    analyzed?: AnalyzedComponent,
    classify?: InterpolationClassifier,
    seedClassify?: SeedTypeClassifier,
): string {
    /* `analyzed` is shared by `compileModule` (analyzed once, classifiers already applied);
       a direct caller (tests) omits it and the front-end runs here — threading `classify` and
       `seedClassify` so type-directed interpolation + cell lowering happen on this path too. */
    const resolved = analyzed ?? analyzeComponent(source, scopeSeed, classify, seedClassify)
    const {
        script,
        stateNames,
        derivedNames,
        computedNames,
        cellReadNames,
        blockingCellNames,
        nodes,
    } = resolved
    const build = generateBuild(
        nodes,
        'host',
        stateNames,
        derivedNames,
        computedNames,
        isLayout,
        cellReadNames,
        blockingCellNames,
    )
    /* The scoped CSS is bundled into the entry stylesheet (see `abideUiPlugin`), not
       injected at runtime; the build only needs the `data-a-…` scope attributes on
       elements, which `generateBuild` reads from each node's annotated `scopes`. */
    return `${script}\n${hoistCells(build, '$$model')}`
}
