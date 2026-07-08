import ts from 'typescript'
import { ABIDE_PACKAGE_NAME } from '../../shared/ABIDE_PACKAGE_NAME.ts'
import { analyzeComponent } from './analyzeComponent.ts'
import { assertRuntimeHelpersBound } from './assertRuntimeHelpersBound.ts'
import { assertTranspiles } from './assertTranspiles.ts'
import { compileComponent } from './compileComponent.ts'
import { compileSSR } from './compileSSR.ts'
import type { AnalyzedComponent } from './types/AnalyzedComponent.ts'
import type { InterpolationClassifier } from './types/InterpolationClassifier.ts'
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
    options: {
        isLayout?: boolean
        moduleId?: string
        hot?: boolean
        /* Type-directed interpolation lowering (ADR-0019): the warm shadow classifier the
           bundler plugin builds per `.abide`. Optional and fail-open — absent, the module
           compiles exactly as before (every interpolation binds as a plain value). */
        classify?: InterpolationClassifier
    } = {},
): { code: string; styles: AnalyzedComponent['styles'] } {
    const isLayout = options.isLayout ?? false
    /* Run the shared front-end once and feed it to both back-ends — the analysis is
       pure over (source, moduleId), so the client and SSR builds reuse one parse
       instead of re-running it. `imports` (hoisted child-component imports) and the
       per-element scopes both come from this single pass. The classifier (when present)
       lowers promise-typed interpolations here, so both back-ends see one lowered tree. */
    const analyzed = analyzeComponent(source, options.moduleId, options.classify)
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
        /* Bridge keys are the bare source names; bind each to its emitted local (`$$`
           alias when set), so the hot body's `$$mountChild(...)` resolves. */
        const names = UI_RUNTIME_IMPORTS.map((entry) =>
            entry.alias === undefined || entry.alias === entry.name
                ? entry.name
                : `${entry.name}: ${entry.alias}`,
        ).join(', ')
        const id = JSON.stringify(options.moduleId)
        /* Hot mode never imports the scoped CSS (it reuses the live bundle's sheet), so
           styles are empty here regardless of the analyzed blocks. */
        return {
            code: `const { ${names}, hotReplace } = window.__abide
${userImports}
function build(host, $props) {
${body}
}
function component(host, $props) {
    return $$mount(host, build, $props)
}
component.build = build
component.__abideId = ${id}
if (!hotReplace(${id}, component)) location.reload()
`,
            styles: [],
        }
    }

    const ssrBody = indent(compileSSR(source, isLayout, options.moduleId, analyzed))
    const moduleBody = `function build(host, $props) {
${body}
}

export default function component(host, $props) {
    return $$mount(host, build, $props)
}

/* Adopt the server-rendered DOM in place instead of rebuilding it. */
export function hydrateInto(host, $props) {
    return $$hydrate(host, build, $props)
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
    /* Parse the generated bodies ONCE and feed the single tree to both AST passes: the
       dead-import filter (`collectIdentifiers`) and the binding backstop
       (`assertRuntimeHelpersBound`). The import block isn't in this tree yet — it is derived
       from the filter's result — so the backstop is told the names that block will bind
       (`importedHelpers`), which is exactly what it would have read from the prepended imports
       had it re-parsed the whole module. `setParentNodes` is required by the backstop's
       `getStart`/line lookups. */
    const bodySource = ts.createSourceFile(
        'module.ts',
        `${userImports}\n${moduleBody}`,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
    )
    const referenced = collectIdentifiers(bodySource)
    /* Independent backstop on the reactive-import drop (`deadReactiveImport`): it decides an
       import is dead from the leading script's own lowered body plus the nested scripts' raw
       text. This re-checks the SAME question against the FINAL generated output — so a drop that
       stranded a live reference (e.g. a nested branch's literal `state.computed`) surfaces as a
       located compile error, not a runtime `ReferenceError: state is not defined`. Mirrors
       `assertRuntimeHelpersBound`, which guards the parallel runtime-helper drop. Uses VALUE
       references (not every identifier): the SSR return object `{ html, state, awaits, resume }`
       names a property `state`, which is not a use of the reactive binding. */
    if (analyzed.droppedReactiveImports.size > 0) {
        const valueReferences = collectValueReferences(bodySource)
        for (const name of analyzed.droppedReactiveImports) {
            if (valueReferences.has(name)) {
                throw new Error(
                    `[abide] component module generation dropped the reactive import \`${name}\` as unused, but the generated output still references it — the dead-import filter undercounted. Please report this with the component source.`,
                )
            }
        }
    }
    const keptImports = UI_RUNTIME_IMPORTS.filter((entry) =>
        referenced.has(entry.alias ?? entry.name),
    )
    const importBlock = keptImports
        .map((entry) => {
            const local =
                entry.alias === undefined || entry.alias === entry.name
                    ? entry.name
                    : `${entry.name} as ${entry.alias}`
            return `import { ${local} } from '${ABIDE_PACKAGE_NAME}/${entry.specifier}'`
        })
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
    /* `assertTranspiles` only proves the output PARSES — a call to an un-imported helper is
       valid syntax, so it slips through. This second guard proves the output is BOUND: every
       runtime helper it calls is actually imported (an independent check of the dead-import
       filter above), turning a runtime `ReferenceError` into a located compile error. It walks
       the SAME tree the filter just parsed, with the kept helper imports supplied as the bound
       set the prepended import block provides. */
    assertRuntimeHelpersBound(
        bodySource,
        new Set(keptImports.map((entry) => entry.alias ?? entry.name)),
        'component module generation',
    )
    return { code: module, styles: analyzed.styles }
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
            insideTemplateLiteral = templateLiteralStateAfter(line, insideTemplateLiteral)
            return indented
        })
        .join('\n')
}

/* Whether the line ENDS inside a multi-line template literal, given whether it
   STARTED inside one. A plain backtick-parity count is wrong: a backtick inside a
   double-quoted string literal (the JSON.stringify'd skeleton markup, e.g.
   `$$skeleton(host, "<p>tick \`here</p>")`) is not a template delimiter, but counting
   it would flip the in-literal state and mis-indent a later real template literal's
   significant whitespace. So skip `'…'`/`"…"` strings when outside a template, and treat
   a template's `${…}` interpolation as code (its own strings/backticks don't toggle the
   outer literal). Escapes are honoured throughout. */
function templateLiteralStateAfter(line: string, startInside: boolean): boolean {
    let inside = startInside
    let index = 0
    while (index < line.length) {
        const char = line[index]
        if (char === '\\') {
            index += 2
            continue
        }
        if (inside) {
            if (char === '`') {
                inside = false
            } else if (char === '$' && line[index + 1] === '{') {
                index = skipInterpolation(line, index + 2)
                continue
            }
            index += 1
            continue
        }
        if (char === '`') {
            inside = true
        } else if (char === '"' || char === "'") {
            index = skipQuoted(line, index + 1, char)
            continue
        }
        index += 1
    }
    return inside
}

/* Advances past a `'…'`/`"…"` string opened at `index` (the char after the quote),
   returning the index after the closing quote (or end of line). Emitted JS string
   literals never carry a raw newline, so they always close on their own line. */
function skipQuoted(line: string, index: number, quote: string): number {
    while (index < line.length) {
        if (line[index] === '\\') {
            index += 2
            continue
        }
        if (line[index] === quote) {
            return index + 1
        }
        index += 1
    }
    return index
}

/* Advances past a template `${…}` interpolation opened at `index` (the char after `{`),
   returning the index after the matching `}` (or end of line). Balances nested braces and
   skips nested strings/templates so their delimiters don't leak into the outer scan. */
function skipInterpolation(line: string, index: number): number {
    let depth = 1
    while (index < line.length && depth > 0) {
        const char = line[index]
        if (char === '\\') {
            index += 2
            continue
        }
        if (char === '"' || char === "'" || char === '`') {
            index = skipQuoted(line, index + 1, char)
            continue
        }
        if (char === '{') {
            depth += 1
        } else if (char === '}') {
            depth -= 1
        }
        index += 1
    }
    return index
}

/* The identifier names a generated module references — every Identifier node, walked
   from the real output's AST so string / comment / HTML-literal contents are excluded.
   Used to decide which runtime helpers to import; reading the output (vs hand-tracking
   emit sites) can never drop a needed import. A full parse (not a raw token scan) is what
   keeps template literals honest: a `${…}` substitution — e.g. `navigate(`/p?ts=${Date.now()}`)`
   in a handler — leaves the scanner unable to find the substitution's closing `}` without
   the parser's re-scan, so a token-only pass mis-reads the rest of the module as template
   text and drops every helper referenced after it (an `import`-less `effect`/`mountChild`
   → a `ReferenceError` at mount → the router's reload fallback → a refresh loop). Takes the
   already-parsed source so the one tree feeds this pass and the binding backstop both. */
function collectIdentifiers(source: ts.SourceFile): Set<string> {
    const names = new Set<string>()
    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
            names.add(node.text)
        }
        node.forEachChild(visit)
    }
    visit(source)
    return names
}

/* The identifiers a module references AS VALUES — the subset of `collectIdentifiers` that
   excludes name-only positions: a property name (`obj.state`), an object-literal key
   (`{ state: v }`), and a declaration/import binding name (the definition, not a use). Used by
   the reactive-import backstop, where a bare identifier presence over-counts: the synthesized
   SSR return `{ html, state, awaits, resume }` names a property `state` that is not a use of the
   reactive binding, so the raw-identifier set would false-positive. */
function collectValueReferences(source: ts.SourceFile): Set<string> {
    const names = new Set<string>()
    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && isValuePosition(node)) {
            names.add(node.text)
        }
        node.forEachChild(visit)
    }
    visit(source)
    return names
}

/* True when `id` stands in a value position — i.e. a reference to a binding, not a name that
   merely labels a property or declares a binding. */
function isValuePosition(id: ts.Identifier): boolean {
    const parent = id.parent
    if (ts.isPropertyAccessExpression(parent) && parent.name === id) {
        return false
    }
    if (ts.isPropertyAssignment(parent) && parent.name === id) {
        return false
    }
    if (
        (ts.isVariableDeclaration(parent) ||
            ts.isParameter(parent) ||
            ts.isFunctionDeclaration(parent) ||
            ts.isBindingElement(parent) ||
            ts.isImportSpecifier(parent) ||
            ts.isImportClause(parent)) &&
        parent.name === id
    ) {
        return false
    }
    return true
}
