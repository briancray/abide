import ts from 'typescript'
import { ABIDE_PACKAGE_NAME } from '../../shared/ABIDE_PACKAGE_NAME.ts'
import { parseTemplate } from './parseTemplate.ts'
import type { CompiledShadow, ShadowMapping } from './types/CompiledShadow.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/*
Framework callables the `.abide` loader injects into a component's scope, imported
into the shadow with their real types so author calls (`effect`, `html`, …)
type-check. `state`/`derived` are imported too as a fallback for stray uses; their
declarations are rewritten to value types so the import is normally unused (fine —
the shadow program disables noUnusedLocals). `prop` has no runtime export, so it
never appears here — every `prop()` declaration is rewritten away. `$props` is the
legacy untyped prop bag (pre-`prop()` sugar) made available raw.
*/
const SHADOW_PREAMBLE = `import { state } from '${ABIDE_PACKAGE_NAME}/ui/state'
import { derived } from '${ABIDE_PACKAGE_NAME}/ui/derived'
import { effect } from '${ABIDE_PACKAGE_NAME}/ui/effect'
import { doc } from '${ABIDE_PACKAGE_NAME}/ui/doc'
import { html } from '${ABIDE_PACKAGE_NAME}/shared/html'
import { snippet } from '${ABIDE_PACKAGE_NAME}/shared/snippet'
declare const $props: Record<string, (() => unknown) | undefined>
void [state, derived, effect, doc, html, snippet]
`

/*
Compiles a `.abide` component into its type-checking shadow — a synthetic TS
module that reconstructs the author scope with value types and references every
template expression in a checkable position (see ADR-0010). The shadow is never
executed; it exists only so `tsc`/the language service can type-check template
expressions and child-component props, with diagnostics mapped back through the
returned segments.

The script's signal surface is rewritten to value types:
  let count = state(0)            →  let count = (0)
  const total = derived(() => …)  →  const total = (() => …)()
  let title = prop<string>('t')   →  Props field + `let title = props['t']`
Everything else (functions, plain consts, imports) is emitted verbatim, so
expressions inside it (e.g. a derived's compute body) are checked and mapped too.
*/
export function compileShadow(source: string): CompiledShadow {
    const builder = createBuilder()
    const leadingScript = source.match(/^\s*<script[^>]*>([\s\S]*?)<\/script>/)
    const scriptBody = leadingScript?.[1] ?? ''
    /* Body starts just past the opening `<script …>`; template just past `</script>`. */
    const scriptStart = leadingScript ? source.indexOf('>', leadingScript.index) + 1 : 0
    const templateStart = leadingScript ? (leadingScript.index ?? 0) + leadingScript[0].length : 0

    const { imports, scope, props } = analyzeScript(scriptBody, scriptStart)
    builder.raw(SHADOW_PREAMBLE)
    for (const line of imports) {
        builder.flush(line)
    }
    builder.raw(`interface __Props {\n${props.join('\n')}\n}\n`)
    /* async so `await` blocks are legal; never executed, so the return is void. */
    builder.raw('export default async function (props: __Props): Promise<void> {\n')
    /* Reference props so an all-optional bag with no reads doesn't read as unused. */
    builder.raw('void props;\n')
    for (const line of scope) {
        builder.flush(line)
    }
    for (const node of parseTemplate(source.slice(templateStart), templateStart).nodes) {
        emitNode(node, builder)
    }
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
    result: () => CompiledShadow
}

/* A reconstructed scope statement plus the segments embedded inside it (the parts
   emitted verbatim from the original script), offset-relative to the line start. */
type ScopeLine = { text: string; segments: ShadowMapping[] }

function createBuilder(): Builder {
    let code = ''
    const mappings: ShadowMapping[] = []
    const builder: Builder = {
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

type ScriptAnalysis = { imports: ScopeLine[]; scope: ScopeLine[]; props: string[] }

/* Walks the leading `<script>` and produces the shadow's module imports, the
   value-typed scope lines, and the Props interface fields. `scriptStart` is the
   body's absolute offset in the source, so verbatim spans map back exactly. */
function analyzeScript(scriptBody: string, scriptStart: number): ScriptAnalysis {
    const imports: ScopeLine[] = []
    const scope: ScopeLine[] = []
    const props: string[] = []
    if (scriptBody.trim() === '') {
        return { imports, scope, props }
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
        const reactive = reactiveDeclarations(statement)
        if (reactive === undefined) {
            /* Plain statement (function, const, expression) — emit verbatim, mapped. */
            scope.push({ text: verbatim(statement), segments: [span(statement, 0)] })
            continue
        }
        for (const declaration of reactive) {
            scope.push(scopeLineFor(declaration, props, verbatim, span))
        }
    }
    return { imports, scope, props }
}

/* The `state`/`derived`/`prop` declarations in a variable statement, or undefined
   if it isn't one declaring them (so the caller emits it verbatim). A statement
   mixing reactive and plain declarations is rare; treated as all-verbatim. */
function reactiveDeclarations(statement: ts.Statement): ts.VariableDeclaration[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const declarations = statement.declarationList.declarations
    const reactive = declarations.filter((declaration) => signalCallee(declaration) !== undefined)
    return reactive.length === declarations.length && reactive.length > 0 ? reactive : undefined
}

/* The callee name of a `NAME = state(...)` / `derived(...)` / `prop(...)` decl. */
function signalCallee(declaration: ts.VariableDeclaration): string | undefined {
    const initializer = declaration.initializer
    if (
        initializer !== undefined &&
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        ['state', 'derived', 'prop'].includes(initializer.expression.text)
    ) {
        return initializer.expression.text
    }
    return undefined
}

/* Builds one scope line for a reactive declaration, projecting it to its value
   type. `prop` also contributes a Props field (pushed into `props`). */
function scopeLineFor(
    declaration: ts.VariableDeclaration,
    props: string[],
    verbatim: (node: ts.Node) => string,
    span: (node: ts.Node, prefixLength: number) => ShadowMapping,
): ScopeLine {
    const name = ts.isIdentifier(declaration.name) ? declaration.name.text : '_'
    const call = declaration.initializer as ts.CallExpression
    const callee = (call.expression as ts.Identifier).text
    if (callee === 'state') {
        /* state<T>(initial): T is the value type — carry it onto the `let` so an
           explicit annotation isn't lost to `any`/`any[]` inference of the initial. */
        const typeNode = call.typeArguments?.[0]
        const annotation = typeNode === undefined ? '' : `: ${verbatim(typeNode)}`
        const init = call.arguments[0]
        if (init === undefined) {
            return { text: `let ${name}${annotation};`, segments: [] }
        }
        const prefix = `let ${name}${annotation} = (`
        return { text: `${prefix}${verbatim(init)});`, segments: [span(init, prefix.length)] }
    }
    if (callee === 'derived') {
        /* derived<T>(compute): T is the value type — annotate so an explicit
           argument isn't lost to inference of the compute's return. */
        const typeNode = call.typeArguments?.[0]
        const annotation = typeNode === undefined ? '' : `: ${verbatim(typeNode)}`
        const fn = call.arguments[0]
        if (fn === undefined) {
            return { text: `const ${name} = undefined;`, segments: [] }
        }
        const prefix = `const ${name}${annotation} = (`
        return { text: `${prefix}${verbatim(fn)})();`, segments: [span(fn, prefix.length)] }
    }
    /* prop<T>('key'): Props field `key[?]: T`, scope binding read from props. */
    const key = call.arguments[0]
    const keyText = key !== undefined && ts.isStringLiteralLike(key) ? key.text : name
    const typeNode = call.typeArguments?.[0]
    const typeText = typeNode === undefined ? 'unknown' : verbatim(typeNode)
    const optional = typeNode === undefined || /\bundefined\b/.test(typeText)
    props.push(`    ${JSON.stringify(keyText)}${optional ? '?' : ''}: ${typeText}`)
    return { text: `let ${name} = props[${JSON.stringify(keyText)}];`, segments: [] }
}

/* Emits a template node's expressions into the shadow's `if (false) {…}` render
   body. Control flow introduces its binding so children type-check against it;
   every expression is referenced in a statement so a type error surfaces and maps. */
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
            node.children.forEach((child) => {
                emitNode(child, builder)
            })
            return
        case 'component': {
            /* Check each prop against the child's declared type. The imported tag
               resolves (via the shadow host) to the child's `(props: Props) => …`
               default, so `Parameters<typeof Child>[0]["name"]` is that prop's type;
               assigning the mapped value to it lands a mismatch diagnostic on the
               offending expression (an annotated target reports the error on the RHS,
               unlike an object literal which reports it on the key). */
            for (const prop of node.props) {
                builder.raw(
                    `((__prop: Parameters<typeof ${node.name}>[0][${JSON.stringify(prop.name)}]) => {})(`,
                )
                builder.expr(prop.code, prop.loc)
                builder.raw(');\n')
            }
            node.children.forEach((child) => {
                emitNode(child, builder)
            })
            return
        }
        case 'if':
            builder.raw('if ')
            builder.expr(node.condition, node.loc)
            builder.raw(' {\n')
            node.children.forEach((child) => {
                emitNode(child, builder)
            })
            builder.raw('}\n')
            return
        case 'each':
            builder.raw(`for (const ${node.as} of `)
            builder.expr(node.items, node.loc)
            builder.raw(') {\n')
            if (node.key !== undefined) {
                builder.raw(`void (${node.key});\n`)
            }
            node.children.forEach((child) => {
                emitNode(child, builder)
            })
            builder.raw('}\n')
            return
        case 'await':
            builder.raw('{\n')
            builder.raw(node.as !== undefined ? `const ${node.as} = await ` : 'await ')
            builder.expr(node.promise, node.loc)
            builder.raw(';\n')
            node.children.forEach((child) => {
                emitNode(child, builder)
            })
            builder.raw('}\n')
            return
        case 'switch':
            builder.stmt(node.subject, node.loc)
            node.children.forEach((child) => {
                emitNode(child, builder)
            })
            return
        case 'case':
            if (node.match !== undefined) {
                builder.stmt(node.match, node.loc)
            }
            node.children.forEach((child) => {
                emitNode(child, builder)
            })
            return
        case 'branch':
            /* then/catch bind the resolved value / error as `any` so children check. */
            builder.raw('{\n')
            if (node.as !== undefined) {
                builder.raw(`const ${node.as} = undefined as any;\n`)
            }
            node.children.forEach((child) => {
                emitNode(child, builder)
            })
            builder.raw('}\n')
            return
        case 'try':
            builder.raw('{\n')
            node.children.forEach((child) => {
                emitNode(child, builder)
            })
            builder.raw('}\n')
            return
        case 'snippet':
            builder.raw(`const ${node.name} = (${node.params ?? ''}) => {\n`)
            node.children.forEach((child) => {
                emitNode(child, builder)
            })
            builder.raw('};\n')
            return
        case 'script':
            /* A scoped reactive `<script>` block — its body is author TS; emit it so
               its references check. Not yet position-mapped (rare). */
            builder.raw(`{\n${node.code}\n}\n`)
            return
        case 'style':
            /* CSS, not TypeScript — nothing for the shadow to type-check. */
            return
    }
}
