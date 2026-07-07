import ts from 'typescript'
import { ABIDE_PACKAGE_NAME } from '../../shared/ABIDE_PACKAGE_NAME.ts'
import { parseTemplate } from './parseTemplate.ts'
import {
    NESTED_REACTIVE_BINDINGS,
    type ReactiveImportBindings,
    reactiveImportBindings,
    resolveReactiveExport,
} from './resolveReactiveExport.ts'
import { signalCallee } from './signalCallee.ts'
import type { CompiledShadow, ShadowDiagnostic, ShadowMapping } from './types/CompiledShadow.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/*
Framework callables the `.abide` loader injects into a component's scope. `snippet`
and `scope` keep their real published types via imports so author calls type-check —
`scope()` is the internal lowering host (a captured handle `const s = scope()` + its
capability calls type-check against the real `Scope`; generated code targets it too).
`state`/`linked`/`computed`/`effect` are the imported reactive surface; when the author
imports one its own binding provides the type, so the ambient fallback for that name is
OMITTED (see `shadowPreamble`) to avoid a duplicate identifier. Otherwise
`state`/`linked`/`computed` are declared ambiently and `effect` is imported as a fallback
for a bare/nested use the top-level rewrite doesn't project (unused when projected — fine,
the shadow disables noUnusedLocals). `props` is the prop reader — destructured
(`const { a = 1 } = props<Shape>()`); a required import (`abide/ui/props`), so the shadow
declares it only when imported, returning the file's contextual shape (route params or
`Record<string, any>`) intersected with its own type argument — additive, so declared props
like `children: Snippet` layer on top instead of re-spelling the route shape.
*/
function shadowPreamble(importedReactives: ReadonlySet<string>): string {
    /* Omit the ambient fallback for a primitive the author imports — its own binding is
       the type, and a second declaration would be a duplicate-identifier error. */
    const lines = [
        importedReactives.has('effect')
            ? undefined
            : `import { effect } from '${ABIDE_PACKAGE_NAME}/ui/effect'`,
        importedReactives.has('watch')
            ? undefined
            : `import { watch } from '${ABIDE_PACKAGE_NAME}/ui/watch'`,
        `import { snippet } from '${ABIDE_PACKAGE_NAME}/shared/snippet'`,
        `import { scope } from '${ABIDE_PACKAGE_NAME}/ui/currentScope'`,
        importedReactives.has('state')
            ? undefined
            : 'declare function state<T>(initial?: T, transform?: (next: T, previous: T) => T): { value: T }',
        importedReactives.has('linked')
            ? undefined
            : 'declare function linked<T>(seed: () => T, transform?: (next: T, previous: T) => T): { value: T }',
        importedReactives.has('computed')
            ? undefined
            : 'declare function computed<T>(compute: () => T): { readonly value: T }',
        /* `effect` is defined either way — the preamble import or the author's own import. */
        'void [effect, snippet, scope]',
    ]
    return `${lines.filter((line) => line !== undefined).join('\n')}\n`
}

/*
Compiles a `.abide` component into its type-checking shadow — a synthetic TS
module that reconstructs the author scope with value types and references every
template expression in a checkable position (see ADR-0010). The shadow is never
executed; it exists only so `tsc`/the language service can type-check template
expressions and child-component props, with diagnostics mapped back through the
returned segments.

The script's signal surface is rewritten to value types:
  let count = state(0)               →  let count = (0)
  const total = computed(() => …)     →  const total = (() => …)()
  const { a } = props<{ a: T }>()    →  `__Props = { a: T }` + the verbatim destructure
Everything else (functions, plain consts, imports) is emitted verbatim, so
expressions inside it (e.g. a computed's compute body) are checked and mapped too.
*/
export function compileShadow(source: string, propsType = 'Record<string, any>'): CompiledShadow {
    const builder = createBuilder()
    const leadingScript = source.match(/^\s*<script[^>]*>([\s\S]*?)<\/script>/)
    const scriptBody = leadingScript?.[1] ?? ''
    /* Body starts just past the opening `<script …>`; template just past `</script>`. */
    const scriptStart = leadingScript ? source.indexOf('>', leadingScript.index) + 1 : 0
    const templateStart = leadingScript ? (leadingScript.index ?? 0) + leadingScript[0].length : 0

    const { imports, types, scope, propsShapes, diagnostics, importedReactives } = analyzeScript(
        scriptBody,
        scriptStart,
    )
    builder.raw(shadowPreamble(importedReactives))
    /* `props` is a required import (`abide/ui/props`). The shadow owns its type so the
       return is file-contextual — the route param shape (page/layout) or `Record<string,
       any>` (component), intersected with the author's annotation `T` so declared props
       (notably `children: Snippet`) are ADDITIVE and route params never need re-spelling.
       Emitted only when imported: a missing import surfaces as "Cannot find name 'props'",
       so `abide check` flags it. */
    if (importedReactives.has('props')) {
        builder.raw(`declare function props<T = {}>(): (${propsType}) & T\n`)
    }
    for (const line of imports) {
        /* The `props` import is replaced by the contextual `declare function props` above;
           emitting it too would be a duplicate-identifier error. */
        if (/from\s*['"][^'"]*\/ui\/props['"]/.test(line.text)) {
            continue
        }
        builder.flush(line)
    }
    /* Component-local `type`/`interface` declarations are hoisted to module scope —
       above `__Props` so prop annotations referencing them resolve, and still visible
       inside the function body where the rest of the scope and template expressions use
       them. (Emitting them as in-function scope lines would hide them from `__Props`.) */
    for (const line of types) {
        builder.flush(line)
    }
    /* The author's scope (value consts, functions, reactive projections, the `props()`
       destructure) is hoisted to module scope — above `__Props` — for the same reason the
       types are: a prop annotation can then reference a value const by `typeof`
       (`size: keyof typeof sizes`), which fails when the const sits in the function body and
       `__Props` at module scope can't see it. Narrowing is unaffected: a template's guard and
       read are both in the render function below, so control-flow narrowing flows regardless
       of where the binding is declared, and reactive projections are never rebound (writes go
       through `.value`), so they narrow like consts even into nested handlers. */
    for (const line of scope) {
        builder.flush(line)
    }
    /* `__Props` is the parent-facing prop shape: each `props<Shape>()` destructure
       contributes its whole `Shape` (intersected if there's more than one), or an empty
       object for a component that reads no props. */
    builder.raw(
        propsShapes.length > 0
            ? `type __Props = ${propsShapes.join(' & ')}\n`
            : `interface __Props {}\n`,
    )
    /* `__props` (not `props`) so the destructuring `props()` sugar resolves to the
       declared function, not this parameter. async so `await` blocks are legal; never
       executed, so the return is void. */
    builder.raw('export default async function (__props: __Props): Promise<void> {\n')
    /* Reference props so an all-optional bag with no reads doesn't read as unused. */
    builder.raw('void __props;\n')
    const templateNodes = parseTemplate(source.slice(templateStart), templateStart).nodes
    /* Nested `<script>` blocks inline into the synchronous `build()` too, so a top-level
       await in one is the same build-breaker — flag it, mapped via the node's body offset. */
    collectNestedScriptAwaitDiagnostics(templateNodes, diagnostics)
    emitNodes(templateNodes, builder)
    builder.raw('}\n')
    return { ...builder.result(), diagnostics }
}

/* The shadow text builder: `raw` appends synthesised scaffolding (no mapping),
   `expr` appends an inline parenthesised source span `(code)` and records its
   segment, `stmt` wraps one as a standalone statement, `flush` appends a
   pre-assembled scope line carrying its own embedded segments. */
type Builder = {
    raw: (text: string) => void
    /* Appends `text` verbatim and maps it back to source, WITHOUT the `expr`
       parens — for binding names and other spans that must stay bare TS syntax
       (`for (const NAME of …)`). `text` must equal the source at `sourceLoc`. */
    mapped: (text: string, sourceLoc: number | undefined) => void
    expr: (code: string, sourceLoc: number | undefined) => void
    stmt: (code: string, sourceLoc: number | undefined) => void
    flush: (line: ScopeLine) => void
    /* A fresh shadow-local binding name (`__<base>_<n>`) — for synthesised bindings
       like an await's resolved value, kept distinct so nested blocks never collide. */
    unique: (base: string) => string
    result: () => CompiledShadow
}

/* A reconstructed scope statement plus the segments embedded inside it (the parts
   emitted verbatim from the original script), offset-relative to the line start. */
type ScopeLine = { text: string; segments: ShadowMapping[] }

function createBuilder(): Builder {
    let code = ''
    let uniqueCounter = 0
    const mappings: ShadowMapping[] = []
    const builder: Builder = {
        unique(base) {
            return `__${base}_${uniqueCounter++}`
        },
        raw(text) {
            code += text
        },
        mapped(text, sourceLoc) {
            if (sourceLoc !== undefined) {
                mappings.push({
                    shadowStart: code.length,
                    sourceStart: sourceLoc,
                    length: text.length,
                })
            }
            code += text
        },
        expr(exprCode, sourceLoc) {
            code += '('
            if (sourceLoc !== undefined) {
                mappings.push({
                    shadowStart: code.length,
                    sourceStart: sourceLoc,
                    length: exprCode.length,
                })
            }
            code += `${exprCode})`
        },
        stmt(exprCode, sourceLoc) {
            code += ';'
            builder.expr(exprCode, sourceLoc)
            code += ';\n'
        },
        flush(line) {
            const base = code.length
            for (const segment of line.segments) {
                mappings.push({ ...segment, shadowStart: base + segment.shadowStart })
            }
            code += `${line.text}\n`
        },
        result: () => ({ code, mappings }),
    }
    return builder
}

type ScriptAnalysis = {
    imports: ScopeLine[]
    types: ScopeLine[]
    scope: ScopeLine[]
    propsShapes: string[]
    diagnostics: ShadowDiagnostic[]
    /* The reactive primitives the author imports (`state`/`effect`), so the preamble
       omits the ambient fallback for each and avoids a duplicate-identifier error. */
    importedReactives: Set<string>
}

/* Pushes a diagnostic for every author binding whose name starts with the reserved `$$`
   prefix — variable/function/class declarations, parameters, and destructuring leaves.
   Read structurally off the parsed script; the message points at the offending name. */
function collectReservedNameDiagnostics(
    file: ts.SourceFile,
    scriptStart: number,
    diagnostics: ShadowDiagnostic[],
): void {
    const flag = (name: ts.Node | undefined): void => {
        if (name !== undefined && ts.isIdentifier(name) && name.text.startsWith('$$')) {
            diagnostics.push({
                start: scriptStart + name.getStart(file),
                length: name.getEnd() - name.getStart(file),
                message: `\`${name.text}\` is reserved — the \`$$\` prefix is the compiler's injected runtime namespace; rename this binding.`,
            })
        }
    }
    const visit = (node: ts.Node): void => {
        if (
            ts.isVariableDeclaration(node) ||
            ts.isFunctionDeclaration(node) ||
            ts.isClassDeclaration(node) ||
            ts.isParameter(node) ||
            ts.isBindingElement(node)
        ) {
            flag(node.name)
        }
        ts.forEachChild(node, visit)
    }
    visit(file)
}

/* Pushes a diagnostic for every `await` sitting at the script's top level — outside any
   nested function. The generated `build()` runs the leading script synchronously, so a
   top-level await transpiles to `await` in a non-async function and breaks the bundle; the
   shadow's render fn is async, so `tsc` alone never flags it (a check/runtime parity gap).
   Stops descending at function boundaries — their own async-ness is the author's concern —
   and catches both `await expr` and `for await (… of …)`, flagging the `await` keyword. */
function collectTopLevelAwaitDiagnostics(
    file: ts.SourceFile,
    scriptStart: number,
    diagnostics: ShadowDiagnostic[],
): void {
    const message =
        'top-level `await` is not allowed in a `<script>` — the component build runs synchronously. Use `{#await expr}…{:then value}…{/await}` markup for blocking data, or `await` inside an async event handler.'
    const visit = (node: ts.Node): void => {
        /* A nested function introduces its own (possibly async) scope; its awaits are legal. */
        if (
            ts.isFunctionDeclaration(node) ||
            ts.isFunctionExpression(node) ||
            ts.isArrowFunction(node) ||
            ts.isMethodDeclaration(node) ||
            ts.isGetAccessorDeclaration(node) ||
            ts.isSetAccessorDeclaration(node) ||
            ts.isConstructorDeclaration(node)
        ) {
            return
        }
        /* The `await` keyword token: the AwaitExpression's first child, or a `for await`'s
           await modifier. */
        const keyword = ts.isAwaitExpression(node)
            ? node.getChildAt(0, file)
            : ts.isForOfStatement(node)
              ? node.awaitModifier
              : undefined
        if (keyword !== undefined) {
            diagnostics.push({
                start: scriptStart + keyword.getStart(file),
                length: keyword.getEnd() - keyword.getStart(file),
                message,
            })
        }
        ts.forEachChild(node, visit)
    }
    visit(file)
}

/* Recursively visits every nested `<script>` in the template and flags a top-level await in
   its body — the same trap as the leading script (it inlines into the sync `build()`), mapped
   through the node's body offset (`loc`). Walks `children` on every node kind that carries
   them, so a script buried in an `{#if}`/`{#for}`/`{#await}` branch is still reached. */
function collectNestedScriptAwaitDiagnostics(
    nodes: TemplateNode[],
    diagnostics: ShadowDiagnostic[],
): void {
    for (const node of nodes) {
        if (node === undefined) {
            continue
        }
        if (node.kind === 'script' && node.loc !== undefined) {
            const file = ts.createSourceFile('nested.ts', node.code, ts.ScriptTarget.Latest, true)
            collectTopLevelAwaitDiagnostics(file, node.loc, diagnostics)
        }
        if ('children' in node) {
            collectNestedScriptAwaitDiagnostics(node.children, diagnostics)
        }
    }
}

/* Walks the leading `<script>` and produces the shadow's module imports, the
   module-scope type declarations, the value-typed scope lines, and the `props<Shape>()`
   prop shapes. `scriptStart` is the body's absolute offset in the source, so verbatim
   spans map back exactly. */
function analyzeScript(scriptBody: string, scriptStart: number): ScriptAnalysis {
    const imports: ScopeLine[] = []
    const types: ScopeLine[] = []
    const scope: ScopeLine[] = []
    const propsShapes: string[] = []
    const diagnostics: ShadowDiagnostic[] = []
    if (scriptBody.trim() === '') {
        return { imports, types, scope, propsShapes, diagnostics, importedReactives: new Set() }
    }
    const file = ts.createSourceFile('script.ts', scriptBody, ts.ScriptTarget.Latest, true)
    /* The author's reactive import bindings (alias-safe) — recognition source for
       `state`/`state.linked`/`state.computed`/`effect`, and the set of imported primitives
       the preamble omits its ambient fallback for. */
    const bindings = reactiveImportBindings(file)
    const importedReactives = new Set(bindings.direct.values())
    /* The `$$` prefix is reserved for the compiler's injected runtime (`$$each`, `$$model`,
       `$$scope`, …), so an author binding may not start with it — that's the contract that
       lets a user freely name a variable after any helper. Flag every such declaration. */
    collectReservedNameDiagnostics(file, scriptStart, diagnostics)
    /* The leading script runs in the synchronous `build()`, so a top-level await breaks the
       bundle — catch it here with a legible message instead of an opaque transpile error. */
    collectTopLevelAwaitDiagnostics(file, scriptStart, diagnostics)
    /* A verbatim span: original text + the segment mapping it back, relative to the
       line start (the caller rebases shadowStart onto the running shadow length). */
    const span = (node: ts.Node, prefixLength: number): ScopeLine['segments'][number] => ({
        shadowStart: prefixLength,
        sourceStart: scriptStart + node.getStart(file),
        length: node.getEnd() - node.getStart(file),
    })
    const verbatim = (node: ts.Node): string => scriptBody.slice(node.getStart(file), node.getEnd())

    for (const statement of file.statements) {
        if (ts.isImportDeclaration(statement)) {
            /* Emit verbatim with a span so hover/go-to resolve on the imported names.
               `abide/ui/state` / `abide/ui/effect` are ordinary author imports now — the
               preamble drops its ambient fallback for whichever names are imported. */
            imports.push({ text: verbatim(statement), segments: [span(statement, 0)] })
            continue
        }
        if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
            /* Hoist to module scope (verbatim, mapped) so prop annotations resolve them. */
            types.push({ text: verbatim(statement), segments: [span(statement, 0)] })
            continue
        }
        const reactive = reactiveDeclarations(statement, bindings)
        if (reactive === undefined) {
            /* Plain statement (function, const, expression) — emit verbatim, mapped. */
            scope.push({ text: verbatim(statement), segments: [span(statement, 0)] })
            continue
        }
        for (const declaration of reactive) {
            scope.push(scopeLineFor(declaration, propsShapes, verbatim, span, bindings))
        }
    }
    return { imports, types, scope, propsShapes, diagnostics, importedReactives }
}

/* Value-projects a nested control-flow `<script>` body the way `analyzeScript`
   projects the leading script's scope: reactive declarations become their value
   type, every other statement stays verbatim. Returns the projected source text
   (unmapped — nested scripts carry no source offset yet), so a branch's markup
   reads a nested signal as its value type instead of the raw `State`/`Computed`. */
function projectNestedScript(code: string): string {
    const file = ts.createSourceFile('nested.ts', code, ts.ScriptTarget.Latest, true)
    /* A nested script can't import — it inherits the module-scope surface by canonical name. */
    const bindings = NESTED_REACTIVE_BINDINGS
    const verbatim = (node: ts.Node): string => code.slice(node.getStart(file), node.getEnd())
    /* No mapping: a zero-length segment the caller drops. */
    const span = (): ShadowMapping => ({ shadowStart: 0, sourceStart: 0, length: 0 })
    return file.statements
        .flatMap((statement) => {
            const reactive = reactiveDeclarations(statement, bindings)
            if (reactive === undefined) {
                return [verbatim(statement)]
            }
            return reactive.map(
                (declaration) => scopeLineFor(declaration, [], verbatim, span, bindings).text,
            )
        })
        .join('\n')
}

/* The `state`/`computed`/`linked`/`props()` declarations in a variable statement, or
   undefined if it isn't one declaring them (so the caller emits it verbatim). A statement
   mixing reactive and plain declarations is rare; treated as all-verbatim. */
function reactiveDeclarations(
    statement: ts.Statement,
    bindings: ReactiveImportBindings,
): ts.VariableDeclaration[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const declarations = statement.declarationList.declarations
    const reactive = declarations.filter(
        (declaration) => signalCallee(declaration, bindings) !== undefined,
    )
    return reactive.length === declarations.length && reactive.length > 0 ? reactive : undefined
}

/* Builds one scope line for a reactive declaration, projecting it to its value
   type. A `props()` destructure contributes its whole shape (pushed into `propsShapes`). */
function scopeLineFor(
    declaration: ts.VariableDeclaration,
    propsShapes: string[],
    verbatim: (node: ts.Node) => string,
    span: (node: ts.Node, prefixLength: number) => ShadowMapping,
    bindings: ReactiveImportBindings,
): ScopeLine {
    const name = ts.isIdentifier(declaration.name) ? declaration.name.text : '_'
    const call = declaration.initializer as ts.CallExpression
    /* The CANONICAL primitive drives value-projection — resolved purely from the import
       binding (so an aliased `s(0)` / `state.computed(...)` projects correctly).
       `verbatim(call.expression)` below keeps the AUTHOR's text for the trailing hover ref. */
    const callee = resolveReactiveExport(call.expression, bindings)
    if (callee === 'props') {
        /* `const {…} = props<Shape>()`: the type arg (default `Record<string, any>`)
           IS the parent-facing prop shape, and the destructure projects verbatim against
           the declared typed `props()` so each binding inherits its value type. */
        const shape = call.typeArguments?.[0]
        propsShapes.push(shape === undefined ? 'Record<string, any>' : verbatim(shape))
        return { text: `const ${verbatim(declaration)};`, segments: [span(declaration, 6)] }
    }
    /* The rewrite drops the callee from the line, so hovering `state`/`computed`/
       `linked` at its call site has nothing to resolve. Append the callee as a
       trailing reference statement (`…; state;`), mapped back to its source span,
       so it resolves to the same primitive the destructure does. */
    const withCalleeRef = (line: ScopeLine): ScopeLine => ({
        text: `${line.text} ${verbatim(call.expression)};`,
        segments: [...line.segments, span(call.expression, line.text.length + 1)],
    })
    if (callee === 'state') {
        /* state<T>(initial): T is the value type — carry it onto the `let` so an
           explicit annotation isn't lost to `any`/`any[]` inference of the initial. */
        const typeNode = call.typeArguments?.[0]
        const annotation = typeNode === undefined ? '' : `: ${verbatim(typeNode)}`
        const init = call.arguments[0]
        if (init === undefined) {
            /* No initial (`state<T>()`): the value is `T | undefined`. A definite-
               assignment assertion (`!`) gives that union without a use-before-assign
               false-positive AND without control-flow narrowing it to just `undefined`
               (an `= undefined` initializer, never reassigned in the shadow, would make
               a guard like `x !== undefined` collapse to `never`). Unguarded access is
               then correctly flagged possibly-undefined; a guard narrows cleanly. */
            const valueType = annotation === '' ? ': unknown' : `${annotation} | undefined`
            /* map the binding name (offset 4, past `let `) so hover/go-to resolve on it */
            return withCalleeRef({
                text: `let ${name}!${valueType};`,
                segments: [span(declaration.name, 4)],
            })
        }
        const prefix = `let ${name}${annotation} = (`
        return withCalleeRef({
            text: `${prefix}${verbatim(init)});`,
            segments: [span(declaration.name, 4), span(init, prefix.length)],
        })
    }
    /* computed<T>(compute) / linked<T>(seed) — the only callees left: T is the value
       type — the call's first arg is a thunk, so invoking it yields the value. Annotate
       so an explicit type argument isn't lost to inference of the thunk's return. */
    const typeNode = call.typeArguments?.[0]
    const annotation = typeNode === undefined ? '' : `: ${verbatim(typeNode)}`
    const fn = call.arguments[0]
    /* `linked` is a writable `State<T>` at runtime (it reseeds AND accepts `.value =`
       writes), so project it as `let`; `computed` is genuinely read-only, so `const`. */
    const keyword = callee === 'linked' ? 'let' : 'const'
    /* binding-name map offset = past the keyword + space (`let ` = 4, `const ` = 6) */
    const keywordOffset = keyword.length + 1
    if (fn === undefined) {
        return withCalleeRef({
            text: `${keyword} ${name} = undefined;`,
            segments: [span(declaration.name, keywordOffset)],
        })
    }
    const prefix = `${keyword} ${name}${annotation} = (`
    return withCalleeRef({
        text: `${prefix}${verbatim(fn)})();`,
        segments: [span(declaration.name, keywordOffset), span(fn, prefix.length)],
    })
}

/* Emits a sibling list — each node standalone via `emitNode`. */
function emitNodes(nodes: TemplateNode[], builder: Builder): void {
    for (const node of nodes) {
        if (node !== undefined) {
            emitNode(node, builder)
        }
    }
}

/* Emits a template node's expressions into the shadow's render body. Control flow
   introduces its binding so children type-check against it; every expression is
   referenced in a statement so a type error surfaces and maps. */
function emitNode(node: TemplateNode, builder: Builder): void {
    switch (node.kind) {
        case 'text':
            for (const part of node.parts) {
                if (part.kind === 'expression') {
                    builder.stmt(part.code, part.loc)
                }
            }
            return
        case 'element':
            for (const attr of node.attrs) {
                /* An interpolated value checks each `{expr}` part on its own offset; every
                   other dynamic attribute checks its single `code`. */
                if (attr.kind === 'interpolated') {
                    for (const part of attr.parts) {
                        if (part.kind === 'expression') {
                            builder.stmt(part.code, part.loc)
                        }
                    }
                } else if (attr.kind !== 'static') {
                    builder.stmt(attr.code, attr.loc)
                }
            }
            emitNodes(node.children, builder)
            return
        case 'component': {
            /* The imported tag resolves (via the shadow host) to the child's
               `(props: Props) => …` default, so `Parameters<typeof Child>[0]` is its prop
               shape. `bind:` / `class:` / `style:` / `attach` and `{...spread}` are
               framework directives (not part of the declared shape), so they are checked
               leniently — each value against its own declared key type — never flagged as
               excess. `on*` callbacks ARE ordinary declared props on a component (abide does
               not auto-forward events to the DOM), so they go through the completeness check
               with the rest — otherwise a required `onsave`/`oncancel` reads as missing even
               when passed, and an undeclared handler slips by unflagged. */
            const handled = (prop: { name: string; spread?: boolean }): boolean =>
                prop.spread === true ||
                prop.name.startsWith('bind:') ||
                prop.name.startsWith('class:') ||
                prop.name.startsWith('style:') ||
                prop.name === 'attach'
            const hasSpread = node.props.some((prop) => prop.spread)
            for (const prop of node.props.filter(handled)) {
                /* Lead with a defensive `;`: an IIFE/object-literal arg starts with `(` or
                   `{`, so without it a preceding scope statement left unterminated (a script
                   ending in a call with no trailing semicolon, e.g. `effect(() => …)`)
                   merges across the newline into `effect(…)(…)` — a spurious "not callable". */
                if (prop.spread) {
                    /* A `{...expr}` spread contributes a SUBSET of the props (required ones
                       may come from another spread/explicit prop), so check it against
                       `Partial<Props>` — every key it does carry must match, without
                       demanding completeness. */
                    builder.raw(`;((__spread: Partial<Parameters<typeof ${node.name}>[0]>) => {})(`)
                } else {
                    builder.raw(
                        `;((__prop: Parameters<typeof ${node.name}>[0][${JSON.stringify(prop.name)}]) => {})(`,
                    )
                }
                builder.expr(prop.code, prop.loc)
                builder.raw(');\n')
            }
            /* The plain data props as one object-literal argument typed to the child's whole
               prop shape: a missing required prop errors on the literal (anchored at the tag
               via the mapped `{`), an unknown prop errors on its key, a wrong type on its
               value. Skipped when a spread is present — a spread may supply required props,
               so completeness can't be demanded; the data props fall back to lenient per-key
               checks instead. */
            const dataProps = node.props.filter((prop) => !handled(prop))
            if (hasSpread) {
                for (const prop of dataProps) {
                    builder.raw(
                        `;((__prop: Parameters<typeof ${node.name}>[0][${JSON.stringify(prop.name)}]) => {})(`,
                    )
                    builder.expr(prop.code, prop.loc)
                    builder.raw(');\n')
                }
            } else {
                builder.raw(`;((__c: Parameters<typeof ${node.name}>[0]): void => { void __c })({`)
                /* A zero-length anchor right after `{`, pointing at the tag: a missing-
                   required-prop error spans the literal from `{`, so it overlaps this and
                   maps to the tag (an empty span trivially satisfies the source-text ==
                   shadow-text invariant). */
                builder.mapped('', node.loc)
                builder.raw('\n')
                for (const prop of dataProps) {
                    /* The key mapped to its source name (excess-prop errors land on the key);
                       the value verbatim-mapped (wrong-type errors land on the value).
                       Hyphenated names (`aria-label`, `data-*`) aren't valid identifiers, so
                       they're wrapped in raw quotes — a string-literal key the parser accepts.
                       The quotes are unmapped; an excess-prop error on the literal starts at the
                       opening quote and overlaps the mapped name, clamping back onto it. */
                    const needsQuoting = !/^[A-Za-z_$][\w$]*$/.test(prop.name)
                    if (needsQuoting) {
                        builder.raw('"')
                    }
                    if (prop.nameLoc !== undefined) {
                        builder.mapped(prop.name, prop.nameLoc)
                    } else {
                        builder.raw(prop.name)
                    }
                    if (needsQuoting) {
                        builder.raw('"')
                    }
                    builder.raw(': ')
                    builder.expr(prop.code, prop.loc)
                    builder.raw(',\n')
                }
                builder.raw('});\n')
            }
            emitNodes(node.children, builder)
            return
        }
        case 'if': {
            /* The optional `<template else>` is a match-less `case` CHILD (the runtime
               pairs it the same way — see `generateIf`); the rest are the then-content.
               Emitting it as a real `else` gives its body the condition's NEGATIVE
               narrowing — emitting it inside the `if` block (as a plain child) instead
               gave it the positive narrowing, so a literal-union compare read as a
               "no overlap" and a typeof-narrowed branch saw the wrong member. */
            const branches = node.children.filter(
                (child): child is Extract<TemplateNode, { kind: 'case' }> => child.kind === 'case',
            )
            const thenChildren = node.children.filter((child) => child.kind !== 'case')
            builder.raw('if ')
            builder.expr(node.condition, node.loc)
            builder.raw(' {\n')
            emitNodes(thenChildren, builder)
            builder.raw('}')
            /* `elseif` → a real `else if` so its body inherits the prior conditions' negative
               narrowing plus its own positive; `else` → the trailing block. */
            for (const branch of branches) {
                if (branch.condition !== undefined) {
                    builder.raw(' else if ')
                    builder.expr(branch.condition, branch.loc)
                    builder.raw(' {\n')
                } else {
                    builder.raw(' else {\n')
                }
                emitNodes(branch.children, builder)
                builder.raw('}')
            }
            builder.raw('\n')
            return
        }
        case 'each':
            /* `for await` over an async each's AsyncIterable, plain `for…of` otherwise —
               so the item binds to the element type under either iteration protocol. The
               binding name is `mapped` (not `raw`) so hover/highlighting land on it. */
            builder.raw(node.async ? 'for await (const ' : 'for (const ')
            builder.mapped(node.as, node.asLoc)
            builder.raw(' of ')
            builder.expr(node.items, node.loc)
            builder.raw(') {\n')
            if (node.key !== undefined) {
                builder.raw('void ')
                builder.expr(node.key, node.keyLoc)
                builder.raw(';\n')
            }
            /* `index="i"` binds the row's position — always a number (the row ordinal,
               or an async stream's arrival count). Declare it so body references check. */
            if (node.index !== undefined) {
                builder.raw('const ')
                builder.mapped(node.index, node.indexLoc)
                builder.raw(': number = 0;\n')
            }
            emitNodes(node.children, builder)
            builder.raw('}\n')
            return
        case 'await': {
            /* Resolve once into a shadow-local; `then` binds it (carrying the awaited
               type so resolved-content props are checked), `catch` binds the error as
               `any` (statically unknowable), `finally` binds nothing. Blocking: the
               non-branch children are the resolved content, bound to `as`. Streaming:
               they're the pending content, checked without the resolved value. */
            const resolved = builder.unique('awaited')
            builder.raw('{\n')
            builder.raw(`const ${resolved} = await `)
            builder.expr(node.promise, node.loc)
            builder.raw(`;\nvoid ${resolved};\n`)
            const pending = node.children.filter((child) => child.kind !== 'branch')
            const branches = node.children.filter((child) => child.kind === 'branch')
            if (node.blocking && node.as !== undefined) {
                builder.raw('{\nconst ')
                builder.mapped(node.as, node.asLoc)
                builder.raw(` = ${resolved};\n`)
                emitNodes(pending, builder)
                builder.raw('}\n')
            } else {
                emitNodes(pending, builder)
            }
            for (const branch of branches) {
                if (branch.kind !== 'branch') {
                    continue
                }
                builder.raw('{\n')
                if (branch.branch === 'then' && branch.as !== undefined) {
                    builder.raw('const ')
                    builder.mapped(branch.as, branch.asLoc)
                    builder.raw(` = ${resolved};\n`)
                } else if (branch.branch === 'catch' && branch.as !== undefined) {
                    builder.raw('const ')
                    builder.mapped(branch.as, branch.asLoc)
                    builder.raw(' = undefined as any;\n')
                }
                emitNodes(branch.children, builder)
                builder.raw('}\n')
            }
            builder.raw('}\n')
            return
        }
        case 'switch':
            /* A real `switch` so a discriminant subject narrows into each case body;
               non-case children (whitespace between cases) carry nothing and are
               skipped. `break` keeps cases independent under `noFallthroughCasesInSwitch`. */
            builder.raw('switch (')
            builder.expr(node.subject, node.loc)
            builder.raw(') {\n')
            for (const child of node.children) {
                if (child.kind !== 'case') {
                    continue
                }
                if (child.match !== undefined) {
                    builder.raw('case ')
                    builder.expr(child.match, child.loc)
                    builder.raw(': {\n')
                } else {
                    builder.raw('default: {\n')
                }
                emitNodes(child.children, builder)
                builder.raw('break;\n}\n')
            }
            builder.raw('}\n')
            return
        case 'case':
            /* Reached only for a stray case outside a switch/if (none today); a `switch`
               emits its own cases and the `if` handler consumes its `else` child. */
            if (node.match !== undefined) {
                builder.stmt(node.match, node.loc)
            }
            emitNodes(node.children, builder)
            return
        case 'branch':
            /* Reached for a `{#try}`'s `catch`/`finally`: the `try` handler emits its
               children directly (guarded content + these branch nodes), so a `{:catch err}`
               binds its error here as `any` (statically unknowable). The `await`/`if`/`switch`
               handlers consume their own branches inline and never route through this case. */
            builder.raw('{\n')
            if (node.as !== undefined) {
                builder.raw(`const ${node.as} = undefined as any;\n`)
            }
            emitNodes(node.children, builder)
            builder.raw('}\n')
            return
        case 'try':
            builder.raw('{\n')
            emitNodes(node.children, builder)
            builder.raw('}\n')
            return
        case 'snippet':
            /* `args={…}` is the parameter list; `mapped` (not `raw`) so hover/highlighting
               land on the binding. `loc` is the `args` expression's offset (see
               toSnippetOrTemplate). The name is a static attribute with no tracked offset. */
            builder.raw(`const ${node.name} = (`)
            if (node.params !== undefined) {
                builder.mapped(node.params, node.loc)
            }
            /* Wrap the body in `snippet(() => …)` so the shadow types the snippet as
               `(args) => SnippetValue` — mirroring the runtime lowering (which returns
               `$$snippet(($host) => …)`) so a snippet passed to a `Snippet`-typed prop
               type-checks instead of reading as `() => void`. */
            builder.raw(') => snippet(() => {\n')
            emitNodes(node.children, builder)
            builder.raw('});\n')
            return
        case 'script':
            /* A scoped reactive `<script>`: value-project its reactive declarations to
               their value types (`computed(…)` → the computed value, `state(…)` → the
               initial) exactly as the leading script's scope lines are, so the branch's
               markup type-checks a nested signal as its value — matching the runtime,
               which derefs nested-script signals through the rest of the branch. Emitted
               INLINE in the current block, not a nested `{…}`, so its bindings reach the
               branch's later siblings (a nested if/each); a wrapping block trapped them,
               surfacing "Cannot find name". Leading `;` guards a preceding semicolon-less
               call from merging in (see the component case). Not yet position-mapped. */
            builder.raw(`;\n${projectNestedScript(node.code)}\n`)
            return
        case 'style':
            /* CSS, not TypeScript — nothing for the shadow to type-check. */
            return
    }
}
