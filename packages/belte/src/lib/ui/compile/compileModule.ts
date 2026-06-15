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
    return `import { doc } from 'belte/ui/doc'
import { state } from 'belte/ui/state'
import { derived } from 'belte/ui/derived'
import { effect } from 'belte/ui/effect'
import { mount } from 'belte/ui/dom/mount'
import { text } from 'belte/ui/dom/text'
import { attr } from 'belte/ui/dom/attr'
import { on } from 'belte/ui/dom/on'
import { each } from 'belte/ui/dom/each'
import { when } from 'belte/ui/dom/when'
import { awaitBlock } from 'belte/ui/dom/awaitBlock'

export default function component(host, $props) {
    return mount(host, (host) => {
${indent(compileComponent(source))}
    })
}

export function render($props) {
${indent(compileSSR(source))}
}

component.render = render
`
}

/* Indents a body block for embedding inside a wrapper function. */
function indent(body: string): string {
    return body
        .split('\n')
        .map((line) => (line === '' ? line : `    ${line}`))
        .join('\n')
}
