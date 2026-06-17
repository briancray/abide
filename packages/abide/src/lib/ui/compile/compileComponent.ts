import { analyzeComponent } from './analyzeComponent.ts'
import { generateBuild } from './generateBuild.ts'
import { hoistCells } from './hoistCells.ts'

/*
Compiles a single-file abide component into the body of a client build function.
Runs the shared front-end (`analyzeComponent`), generates the DOM build from the
template, and hoists static paths to cells. The returned body runs against a
`host` element with `doc`/`state`/`derived`/`effect` and the dom bindings in
scope and defines `model` itself. `compileModule` wraps it (and the SSR body) into
a real module; tests wrap it with `new Function`.
*/
export function compileComponent(source: string, isLayout = false, scopeSeed?: string): string {
    const { script, stateNames, derivedNames, nodes } = analyzeComponent(source, scopeSeed)
    const build = generateBuild(nodes, 'host', stateNames, derivedNames, isLayout)
    /* The scoped CSS is bundled into the entry stylesheet (see `abideUiPlugin`), not
       injected at runtime; the build only needs the `data-a-…` scope attributes on
       elements, which `generateBuild` reads from each node's annotated `scopes`. */
    return `${script}\n${hoistCells(build, 'model')}`
}
