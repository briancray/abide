import { ABIDE_PACKAGE_NAME } from '../../shared/ABIDE_PACKAGE_NAME.ts'
import { analyzeComponent } from './analyzeComponent.ts'
import { compileComponent } from './compileComponent.ts'
import { compileSSR } from './compileSSR.ts'

/*
Wraps a component into a complete ES module with two entry points:

  - default `component(host, $props)` — mounts the client build, returns the
    disposer (`import Counter from './Counter.abide'; const stop = Counter(host)`);
  - `render($props)` — server-renders to `{ html, state, awaits }` for SSR.

`render` is also attached to the default export (`component.render`) so a parent
can server-render a child it imported by its default name. Both entry points share
the lowered script and template (via the shared front-end), so client and server
always agree. The `abide/ui/*` imports resolve through the package exports. This is
what the `.abide` bundler loader emits.
*/
export function compileModule(source: string, options: { isLayout?: boolean } = {}): string {
    const isLayout = options.isLayout ?? false
    /* Component-authored imports (e.g. child components) hoisted to module scope. */
    const analyzed = analyzeComponent(source)
    const userImports = analyzed.imports
    const body = indent(compileComponent(source, isLayout))
    const ui = `${ABIDE_PACKAGE_NAME}/ui`
    const ssrBody = indent(compileSSR(source, isLayout))
    return `import { html } from '${ABIDE_PACKAGE_NAME}/shared/html'
import { snippet } from '${ABIDE_PACKAGE_NAME}/shared/snippet'
import { doc } from '${ui}/doc'
import { state } from '${ui}/state'
import { derived } from '${ui}/derived'
import { effect } from '${ui}/effect'
import { mount } from '${ui}/dom/mount'
import { openChild } from '${ui}/dom/openChild'
import { openRoot } from '${ui}/dom/openRoot'
import { appendText } from '${ui}/dom/appendText'
import { appendSnippet } from '${ui}/dom/appendSnippet'
import { appendStatic } from '${ui}/dom/appendStatic'
import { attr } from '${ui}/dom/attr'
import { on } from '${ui}/dom/on'
import { each } from '${ui}/dom/each'
import { eachAsync } from '${ui}/dom/eachAsync'
import { when } from '${ui}/dom/when'
import { awaitBlock } from '${ui}/dom/awaitBlock'
import { tryBlock } from '${ui}/dom/tryBlock'
import { switchBlock } from '${ui}/dom/switchBlock'
import { injectStyle } from '${ui}/dom/injectStyle'
import { hydrate } from '${ui}/dom/hydrate'
import { nextBlockId } from '${ui}/runtime/nextBlockId'
import { enterRenderPass } from '${ui}/runtime/enterRenderPass'
import { exitRenderPass } from '${ui}/runtime/exitRenderPass'
${userImports}

export default function component(host, $props) {
    return mount(host, (host) => {
${body}
    })
}

/* Adopt the server-rendered DOM in place instead of rebuilding it. */
export function hydrateInto(host, $props) {
    return hydrate(host, (host) => {
${body}
    })
}

export function render($props) {
${ssrBody}
}

component.render = render
component.hydrate = hydrateInto
component.hydratable = ${analyzed.hydratable}
`
}

/* Indents a body block for embedding inside a wrapper function. */
function indent(body: string): string {
    return body
        .split('\n')
        .map((line) => (line === '' ? line : `    ${line}`))
        .join('\n')
}
