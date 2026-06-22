import { ABIDE_PACKAGE_NAME } from '../../shared/ABIDE_PACKAGE_NAME.ts'
import { analyzeComponent } from './analyzeComponent.ts'
import { compileComponent } from './compileComponent.ts'
import { compileSSR } from './compileSSR.ts'
import { UI_RUNTIME_IMPORTS } from './UI_RUNTIME_IMPORTS.ts'

/*
Wraps a component into a complete ES module with two entry points:

  - default `component(host, $props)` — mounts the client build, returns the
    disposer (`import Counter from './Counter.abide'; const stop = Counter(host)`);
  - `render($props, $ctx)` — async, server-renders to `{ html, state, awaits, resume }`
    for SSR. `$ctx` is the request-local block-id counter, threaded so a child's
    `await`/`try` ids share the page's depth-first numbering; omitted at the top level
    (a fresh counter defaults in).

`render` is also attached to the default export (`component.render`) so a parent
can server-render a child it imported by its default name. Both entry points share
the lowered script and template (via the shared front-end), so client and server
always agree. The `abide/ui/*` imports resolve through the package exports. This is
what the `.abide` bundler loader emits.
*/
export function compileModule(
    source: string,
    options: { isLayout?: boolean; moduleId?: string; hot?: boolean } = {},
): string {
    const isLayout = options.isLayout ?? false
    /* Run the shared front-end once and feed it to both back-ends — the analysis is
       pure over (source, moduleId), so the client and SSR builds reuse one parse
       instead of re-running it. `imports` (hoisted child-component imports) and the
       per-element scopes both come from this single pass. */
    const analyzed = analyzeComponent(source, options.moduleId)
    const userImports = analyzed.imports
    const body = indent(compileComponent(source, isLayout, options.moduleId, analyzed))

    /* Hot module (dev component HMR): the same client build, but its runtime comes
       from the live bundle via `window.__abide` — so it shares the one reactive graph
       and instance registry, not fresh copies — and on load it hands the new factory
       to `hotReplace`, which disposes + re-runs every live instance in place. No SSR /
       hydrate / export: it is imported only to replace, never mounted fresh. Supports
       leaf components today; one importing children falls back to a reload (the dev
       layer decides what to hot-swap). */
    if (options.hot) {
        const names = UI_RUNTIME_IMPORTS.map((entry) => entry.name).join(', ')
        const id = JSON.stringify(options.moduleId)
        return `const { ${names}, hotReplace } = window.__abide
${userImports}
function build(host, $props) {
${body}
}
function component(host, $props) {
    return mount(host, build, $props)
}
component.build = build
component.__abideId = ${id}
if (!hotReplace(${id}, component)) location.reload()
`
    }

    const ssrBody = indent(compileSSR(source, isLayout, options.moduleId, analyzed))
    /* Per-component dead-import elimination: emit only the runtime names this module
       actually references. A component that uses no `each`/`await`/`html` shouldn't
       drag those modules into its chunk. The package isn't globally side-effect-free
       (the dev/runtime entries register globals), so a bundler can't tree-shake the
       unused imports for us — but the generated code is the one place that knows
       exactly which names it emitted, so it filters here. A name absent from the body
       is unreferenced; erring toward inclusion (a stray match in user script) only
       keeps a harmless unused import, never drops a needed one. */
    const moduleBody = `function build(host, $props) {
${body}
}

export default function component(host, $props) {
    return mount(host, build, $props)
}

/* Adopt the server-rendered DOM in place instead of rebuilding it. */
export function hydrateInto(host, $props) {
    return hydrate(host, build, $props)
}

export function render($props, $ctx) {
${ssrBody}
}

component.render = render
component.hydrate = hydrateInto
/* The bare build, so a parent can range-mount this as a nested child (no wrapper). */
component.build = build
component.hydratable = ${analyzed.hydratable}
${options.moduleId === undefined ? '' : `component.__abideId = ${JSON.stringify(options.moduleId)}\n`}`
    /* Scope each name to the surface that genuinely references it. The SSR body
       carries fixed boilerplate ($attr/$text helpers, `<!--abide:html-->` markers,
       the `{ html, state, awaits }` return shape) whose substrings would falsely
       match value/DOM imports — so client helpers are matched against the client
       build, render-pass helpers against the SSR body, and the two wrapper calls
       (mount/hydrate) are always present. */
    const clientSurface = `${userImports}\n${body}`
    const isReferenced = (entry: { name: string; specifier: string }): boolean => {
        if (entry.name === 'mount' || entry.name === 'hydrate') {
            return true
        }
        /* The SSR render always brackets itself with a per-render scope (compileSSR),
           so these are referenced whenever the `render` export is — i.e. always. */
        if (entry.name === 'enterScope' || entry.name === 'exitScope') {
            return true
        }
        /* Render-pass helpers are emitted by both back-ends (e.g. client and server
           await/try blocks both call nextBlockId); their names are distinctive enough
           that scanning both surfaces adds no false match. */
        const surface = entry.specifier.startsWith('ui/runtime/')
            ? `${clientSurface}\n${ssrBody}`
            : clientSurface
        return new RegExp(`\\b${entry.name}\\b`).test(surface)
    }
    const importBlock = UI_RUNTIME_IMPORTS.filter(isReferenced)
        .map((entry) => `import { ${entry.name} } from '${ABIDE_PACKAGE_NAME}/${entry.specifier}'`)
        .join('\n')
    return `${importBlock}
${userImports}

${moduleBody}`
}

/* Indents a body block for embedding inside a wrapper function. Lines whose start
   sits inside a multi-line template literal are left untouched — their leading
   whitespace is significant string content (e.g. a CodeBlock's `code={`…`}`
   snippet), and indenting it would corrupt the rendered sample. An odd count of
   unescaped backticks on a line flips in/out of a literal. */
function indent(body: string): string {
    let insideTemplateLiteral = false
    return body
        .split('\n')
        .map((line) => {
            const indented = insideTemplateLiteral || line === '' ? line : `    ${line}`
            if (unescapedBacktickCount(line) % 2 === 1) {
                insideTemplateLiteral = !insideTemplateLiteral
            }
            return indented
        })
        .join('\n')
}

/* Counts backticks not preceded by a backslash — the template-literal delimiters
   on a line, ignoring escaped `\`` inside one. */
function unescapedBacktickCount(line: string): number {
    let count = 0
    for (let index = 0; index < line.length; index += 1) {
        if (line[index] === '`' && line[index - 1] !== '\\') {
            count += 1
        }
    }
    return count
}
