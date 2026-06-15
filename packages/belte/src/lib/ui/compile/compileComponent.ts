import { analyzeComponent } from './analyzeComponent.ts'
import { generateBuild } from './generateBuild.ts'
import { hoistCells } from './hoistCells.ts'

/*
Compiles a single-file belte component into the body of a client build function.
Runs the shared front-end (`analyzeComponent`), generates the DOM build from the
template, and hoists static paths to cells. The returned body runs against a
`host` element with `doc`/`state`/`derived`/`effect` and the dom bindings in
scope and defines `model` itself. `compileModule` wraps it (and the SSR body) into
a real module; tests wrap it with `new Function`.
*/
export function compileComponent(source: string): string {
    const { script, stateNames, derivedNames, nodes } = analyzeComponent(source)
    const build = generateBuild(nodes, 'host', stateNames, derivedNames)
    return `${script}\n${hoistCells(build, 'model')}`
}
