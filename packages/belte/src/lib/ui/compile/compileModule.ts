import { BELTE_PACKAGE_NAME } from '../../shared/BELTE_PACKAGE_NAME.ts'
import { analyzeComponent } from './analyzeComponent.ts'
import { compileComponent } from './compileComponent.ts'
import { compileSSR } from './compileSSR.ts'

/*
Wraps a component into a complete ES module with two entry points:

  - default `component(host, $props)` — mounts the client build, returns the
    disposer (`import Counter from './Counter.belte'; const stop = Counter(host)`);
  - `render($props)` — server-renders to `{ html, state, awaits }` for SSR.

`render` is also attached to the default export (`component.render`) so a parent
can server-render a child it imported by its default name. Both entry points share
the lowered script and template (via the shared front-end), so client and server
always agree. The `belte/ui/*` imports resolve through the package exports. This is
what the `.belte` bundler loader emits.
*/
export function compileModule(source: string): string {
    /* Component-authored imports (e.g. child components) hoisted to module scope. */
    const analyzed = analyzeComponent(source)
    const userImports = analyzed.imports
    const body = indent(compileComponent(source))
    const ui = `${BELTE_PACKAGE_NAME}/ui`
    return `import { html } from '${BELTE_PACKAGE_NAME}/shared/html'
import { doc } from '${ui}/doc'
import { state } from '${ui}/state'
import { derived } from '${ui}/derived'
import { effect } from '${ui}/effect'
import { mount } from '${ui}/dom/mount'
import { openChild } from '${ui}/dom/openChild'
import { openRoot } from '${ui}/dom/openRoot'
import { appendText } from '${ui}/dom/appendText'
import { appendStatic } from '${ui}/dom/appendStatic'
import { attr } from '${ui}/dom/attr'
import { on } from '${ui}/dom/on'
import { each } from '${ui}/dom/each'
import { when } from '${ui}/dom/when'
import { awaitBlock } from '${ui}/dom/awaitBlock'
import { switchBlock } from '${ui}/dom/switchBlock'
import { injectStyle } from '${ui}/dom/injectStyle'
import { hydrate } from '${ui}/dom/hydrate'
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
${indent(compileSSR(source))}
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
