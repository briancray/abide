import ts from 'typescript'
import { ABIDE_PACKAGE_NAME } from '../../shared/ABIDE_PACKAGE_NAME.ts'
import { analyzeComponent } from './analyzeComponent.ts'
import { assertTranspiles } from './assertTranspiles.ts'
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
    /* Per-component dead-import elimination: emit only the runtime helpers this module
       references. A component using no `each`/`await`/`html` shouldn't drag those modules
       into its chunk, and the package isn't globally side-effect-free (the dev/runtime
       entries register globals), so a bundler can't tree-shake them for us.
       Which to keep: tokenize the generated body and keep the names it genuinely
       references. Reading the ACTUAL output (not hand-tracking emit sites) is safe by
       construction — it can never drop a needed import, the way a missed emit-site tag
       could. Tokenizing rather than substring-matching (`\bname\b`) means a name inside a
       string/comment/HTML literal (e.g. an `on`-attribute in static markup) no longer
       forces a spurious import, so no per-surface scoping is needed: a client-only helper
       simply doesn't appear as an identifier in the SSR body. */
    const referenced = collectIdentifiers(`${userImports}\n${body}\n${ssrBody}\n${moduleBody}`)
    const importBlock = UI_RUNTIME_IMPORTS.filter((entry) => referenced.has(entry.name))
        .map((entry) => `import { ${entry.name} } from '${ABIDE_PACKAGE_NAME}/${entry.specifier}'`)
        .join('\n')
    const module = `${importBlock}
${userImports}

${moduleBody}`
    /* Fail-loud over the WHOLE module, not just the script: the `generateBuild` /
       `generateSSR` back-ends emit the build and render bodies as string-codegen, the
       largest un-typed surface in the pipeline. A corruption there (a bad emit on a
       template shape no test exercises) otherwise ships as a broken bundle; this surfaces
       it as a located compile error for every component. */
    assertTranspiles(module, 'component module generation')
    return module
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

/* The identifier names a generated module references — every Identifier token, scanned
   from the real output so string / comment / HTML-literal contents are excluded. Used to
   decide which runtime helpers to import; reading the output (vs hand-tracking emit
   sites) can never drop a needed import. */
function collectIdentifiers(code: string): Set<string> {
    const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        /* skipTrivia */ true,
        ts.LanguageVariant.Standard,
        code,
    )
    const names = new Set<string>()
    for (
        let token = scanner.scan();
        token !== ts.SyntaxKind.EndOfFileToken;
        token = scanner.scan()
    ) {
        if (token === ts.SyntaxKind.Identifier) {
            names.add(scanner.getTokenValue())
        }
    }
    return names
}
