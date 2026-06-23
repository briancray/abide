import ts from 'typescript'
import { ABIDE_PACKAGE_NAME } from '../../shared/ABIDE_PACKAGE_NAME.ts'
import { parseTemplate } from './parseTemplate.ts'
import { REACTIVE_CALLEES } from './REACTIVE_CALLEES.ts'
import type { CompiledShadow, ShadowMapping } from './types/CompiledShadow.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/*
Framework callables the `.abide` loader injects into a component's scope. `effect`,
`html`, `snippet`, and `scope` keep their real published types via imports so author
calls type-check — `scope()` is the authored reactive surface (`scope().state(...)` /
`.computed(...)` / `.undo()` …), so it must resolve like any import. `state`/`linked`/
`computed` are ALSO declared ambiently as a fallback for the rare bare/nested use the
top-level rewrite doesn't project (their top-level declarations become value types, so
these are normally unused — fine, the shadow disables noUnusedLocals). `props` is the prop
reader — destructured (`const { a = 1 } = props<Shape>()`); declared returning its type
argument (default `Record<string, any>`) so each binding inherits its prop type and its
`= default` narrows.
*/
const SHADOW_PREAMBLE = `import { effect } from '${ABIDE_PACKAGE_NAME}/ui/effect'
import { html } from '${ABIDE_PACKAGE_NAME}/shared/html'
import { snippet } from '${ABIDE_PACKAGE_NAME}/shared/snippet'
import { scope } from '${ABIDE_PACKAGE_NAME}/ui/scope'
declare function state<T>(initial?: T, transform?: (next: T, previous: T) => T): { value: T }
declare function linked<T>(seed: () => T, transform?: (next: T, previous: T) => T): { value: T }
declare function computed<T>(compute: () => T): { readonly value: T }
declare function props<T = Record<string, any>>(): T
void [effect, html, snippet, scope]
`

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
export function compileShadow(source: string): CompiledShadow {
    const builder = createBuilder()
    const leadingScript = source.match(/^\s*<script[^>]*>([\s\S]*?)<\/script>/)
    const scriptBody = leadingScript?.[1] ?? ''
    /* Body starts just past the opening `<script …>`; template just past `</script>`. */
    const scriptStart = leadingScript ? source.indexOf('>', leadingScript.index) + 1 : 0
    const templateStart = leadingScript ? (leadingScript.index ?? 0) + leadingScript[0].length : 0

    const { imports, types, scope, propsShapes } = analyzeScript(scriptBody, scriptStart)
    builder.raw(SHADOW_PREAMBLE)
    for (const line of imports) {
        builder.flush(line)
    }
    /* Component-local `type`/`interface` declarations are hoisted to module scope —
       above `__Props` so prop annotations referencing them resolve, and still visible
       inside the function body where the rest of the scope and template expressions use
       them. (Emitting them as in-function scope lines would hide them from `__Props`.) */
    for (const line of types) {
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
    for (const line of scope) {
        builder.flush(line)
    }
    emitNodes(parseTemplate(source.slice(templateStart), templateStart).nodes, builder)
    builder.raw('}\n')
    return builder.result()
}

/* The shadow text builder: `raw` appends synthesised scaffolding (no mapping),
   `expr` appends an inline parenthesised source span `(code)` and records its
   segment, `stmt` wraps one as a standalone statement, `flush` appends a
   pre-assembled scope line carrying its own embedded segments. */
type Builder = {
    raw: (text: string) => void
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
    if (scriptBody.trim() === '') {
        return { imports, types, scope, propsShapes }
    }
    const file = ts.createSourceFile('script.ts', scriptBody, ts.ScriptTarget.Latest, true)
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
            /* Emit verbatim with a span so hover/go-to resolve on the imported names. */
            imports.push({ text: verbatim(statement), segments: [span(statement, 0)] })
            continue
        }
        if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
            /* Hoist to module scope (verbatim, mapped) so prop annotations resolve them. */
            types.push({ text: verbatim(statement), segments: [span(statement, 0)] })
            continue
        }
        const reactive = reactiveDeclarations(statement)
        if (reactive === undefined) {
            /* Plain statement (function, const, expression) — emit verbatim, mapped. */
            scope.push({ text: verbatim(statement), segments: [span(statement, 0)] })
            continue
        }
        for (const declaration of reactive) {
            scope.push(scopeLineFor(declaration, propsShapes, verbatim, span))
        }
    }
    return { imports, types, scope, propsShapes }
}

/* Value-projects a nested control-flow `<script>` body the way `analyzeScript`
   projects the leading script's scope: reactive declarations become their value
   type, every other statement stays verbatim. Returns the projected source text
   (unmapped — nested scripts carry no source offset yet), so a branch's markup
   reads a nested signal as its value type instead of the raw `State`/`Computed`. */
function projectNestedScript(code: string): string {
    const file = ts.createSourceFile('nested.ts', code, ts.ScriptTarget.Latest, true)
    const verbatim = (node: ts.Node): string => code.slice(node.getStart(file), node.getEnd())
    /* No mapping: a zero-length segment the caller drops. */
    const span = (): ShadowMapping => ({ shadowStart: 0, sourceStart: 0, length: 0 })
    return file.statements
        .flatMap((statement) => {
            const reactive = reactiveDeclarations(statement)
            if (reactive === undefined) {
                return [verbatim(statement)]
            }
            return reactive.map((declaration) => scopeLineFor(declaration, [], verbatim, span).text)
        })
        .join('\n')
}

/* The `state`/`computed`/`linked`/`props()` declarations in a variable statement, or
   undefined if it isn't one declaring them (so the caller emits it verbatim). A statement
   mixing reactive and plain declarations is rare; treated as all-verbatim. */
function reactiveDeclarations(statement: ts.Statement): ts.VariableDeclaration[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const declarations = statement.declarationList.declarations
    const reactive = declarations.filter((declaration) => signalCallee(declaration) !== undefined)
    return reactive.length === declarations.length && reactive.length > 0 ? reactive : undefined
}

/* The callee name of a `NAME = state(...)` / `linked(...)` / `computed(...)` /
   `props()` decl — bare or the explicit scope form (`scope().state(...)` / `c.state(...)`),
   receiver-agnostic (the method name marks it reactive). */
function signalCallee(declaration: ts.VariableDeclaration): string | undefined {
    const initializer = declaration.initializer
    if (initializer === undefined || !ts.isCallExpression(initializer)) {
        return undefined
    }
    const callee = initializer.expression
    const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined
    return name !== undefined && REACTIVE_CALLEES.has(name) ? name : undefined
}

/* Builds one scope line for a reactive declaration, projecting it to its value
   type. A `props()` destructure contributes its whole shape (pushed into `propsShapes`). */
function scopeLineFor(
    declaration: ts.VariableDeclaration,
    propsShapes: string[],
    verbatim: (node: ts.Node) => string,
    span: (node: ts.Node, prefixLength: number) => ShadowMapping,
): ScopeLine {
    const name = ts.isIdentifier(declaration.name) ? declaration.name.text : '_'
    const call = declaration.initializer as ts.CallExpression
    /* Bare callee (`state`) or member callee (`scope().state` / `c.state`). */
    const callee = ts.isPropertyAccessExpression(call.expression)
        ? call.expression.name.text
        : (call.expression as ts.Identifier).text
    if (callee === 'props') {
        /* `const {…} = props<Shape>()`: the type arg (default `Record<string, any>`)
           IS the parent-facing prop shape, and the destructure projects verbatim against
           the declared typed `props()` so each binding inherits its value type. */
        const shape = call.typeArguments?.[0]
        propsShapes.push(shape === undefined ? 'Record<string, any>' : verbatim(shape))
        return { text: `const ${verbatim(declaration)};`, segments: [span(declaration, 6)] }
    }
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
            return { text: `let ${name}!${valueType};`, segments: [span(declaration.name, 4)] }
        }
        const prefix = `let ${name}${annotation} = (`
        return {
            text: `${prefix}${verbatim(init)});`,
            segments: [span(declaration.name, 4), span(init, prefix.length)],
        }
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
        return {
            text: `${keyword} ${name} = undefined;`,
            segments: [span(declaration.name, keywordOffset)],
        }
    }
    const prefix = `${keyword} ${name}${annotation} = (`
    return {
        text: `${prefix}${verbatim(fn)})();`,
        segments: [span(declaration.name, keywordOffset), span(fn, prefix.length)],
    }
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
                if (attr.kind !== 'static') {
                    builder.stmt(attr.code, attr.loc)
                }
            }
            emitNodes(node.children, builder)
            return
        case 'component': {
            /* Check each prop against the child's declared type. The imported tag
               resolves (via the shadow host) to the child's `(props: Props) => …`
               default, so `Parameters<typeof Child>[0]["name"]` is that prop's type;
               assigning the mapped value to it lands a mismatch diagnostic on the
               offending expression (an annotated target reports the error on the RHS,
               unlike an object literal which reports it on the key). */
            for (const prop of node.props) {
                /* Lead with a defensive `;`: this IIFE is the one shadow emission that
                   starts with `(`, so without it a preceding scope statement left
                   unterminated (a script ending in a call with no trailing semicolon,
                   e.g. `effect(() => …)`) merges across the newline into `effect(…)(…)`
                   — a spurious "not callable" on the author's last statement. */
                if (prop.spread) {
                    /* A `{...expr}` spread contributes a SUBSET of the props (required ones
                       may come from another spread/explicit prop), so check it against
                       `Partial<Props>` — every key it does carry must match the child's
                       declared type, without demanding completeness. */
                    builder.raw(`;((__spread: Partial<Parameters<typeof ${node.name}>[0]>) => {})(`)
                } else {
                    builder.raw(
                        `;((__prop: Parameters<typeof ${node.name}>[0][${JSON.stringify(prop.name)}]) => {})(`,
                    )
                }
                builder.expr(prop.code, prop.loc)
                builder.raw(');\n')
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
               so the item binds to the element type under either iteration protocol. */
            builder.raw(
                node.async ? `for await (const ${node.as} of ` : `for (const ${node.as} of `,
            )
            builder.expr(node.items, node.loc)
            builder.raw(') {\n')
            if (node.key !== undefined) {
                builder.raw(`void (${node.key});\n`)
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
                builder.raw(`{\nconst ${node.as} = ${resolved};\n`)
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
                    builder.raw(`const ${branch.as} = ${resolved};\n`)
                } else if (branch.branch === 'catch' && branch.as !== undefined) {
                    builder.raw(`const ${branch.as} = undefined as any;\n`)
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
            /* Reached only for a stray branch outside an await (none today); the await
               handler binds resolved/error types for its own branch children. */
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
            builder.raw(`const ${node.name} = (${node.params ?? ''}) => {\n`)
            emitNodes(node.children, builder)
            builder.raw('};\n')
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
