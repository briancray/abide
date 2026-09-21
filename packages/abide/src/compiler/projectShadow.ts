import type { AbideFile } from './parseAbide.ts'
import type { TemplateNode } from './TemplateNode.ts'
import { tokenise } from './tokenise.ts'

export type Span = { start: number; end: number }

// A `.abide` FILE AS ONE TYPESCRIPT PROGRAM: its `<script module>`, its `<script>`, and every
// expression its template holds, each where the scopes it stands in are. The checker reads this
// text and answers, per occurrence, which binding a name reaches (31.3) — and the emitters lower
// the same text, span by span, so an offset means one thing on both sides.
//
// 31.10 FALLS OUT OF THE SHAPE. A `{#for}` is a `for … of` binding its item and its index, so the
// body's slots reach the row's binding and never the page's name of the same spelling. The SUBJECT
// stands before the loop, because 31.10's shadow does not reach it.
//
// EVERY EXPRESSION IS ITS OWN STATEMENT, `;(…)`, so an author's script that ends without a
// semicolon cannot run into the first slot, and a slot's own right-hand side ends at its `)`.
export type Projection = {
    text: string
    modules: Span
    scripts: Span
    // Per holder — an expression node, an attribute, an `{#if}` arm, a `{#for}` block — the span of
    // the expression it holds.
    slots: Map<object, Span>
    // Per `{#for}` block, the span of its `by` key, which stands inside the loop and sees the row.
    keys: Map<object, Span>
}

// ONE PROJECTION PER PARSED FILE. The checker asks of it and both emitters lower it, and a build
// hands all three the same `AbideFile` — projected per caller it was three walks and three copies
// of the file's text for one answer.
const PROJECTED = new WeakMap<AbideFile, Projection>()

export function projectShadow(file: AbideFile): Projection {
    let projection = PROJECTED.get(file)
    if (projection === undefined) {
        projection = project(file)
        PROJECTED.set(file, projection)
    }
    return projection
}

function project(file: AbideFile): Projection {
    let text = file.modules.join('\n')
    const modules = { start: 0, end: text.length }
    text += '\n;\n'
    const scriptsStart = text.length
    const scriptsText = file.scripts.join('\n')
    text += scriptsText
    const scripts = { start: scriptsStart, end: text.length }
    text += '\n'
    const slots = new Map<object, Span>()
    const keys = new Map<object, Span>()

    const expression = (source: string): Span => {
        text += ';('
        const span = { start: text.length, end: text.length + source.length }
        text += `${source})\n`
        return span
    }

    const walk = (nodes: TemplateNode[]): void => {
        for (const node of nodes) {
            if (node.kind === 'text') continue
            if (node.kind === 'expression') {
                slots.set(node, expression(node.source))
                continue
            }
            if (node.kind === 'element') {
                for (const attribute of node.attributes)
                    if (attribute.expression)
                        slots.set(attribute, expression(attribute.value))
                walk(node.children)
                continue
            }
            if (node.block === 'if') {
                for (const branch of node.branches) {
                    if (branch.subject !== '')
                        slots.set(branch, expression(branch.subject))
                    walk(branch.children)
                }
                continue
            }
            slots.set(node, expression(node.subject))
            text += `for (const ${node.item} of [] as any[]) {\n`
            if (node.index !== '') text += `const ${node.index} = 0\n`
            if (node.key !== '') keys.set(node, expression(node.key))
            walk(node.children)
            text += '}\n'
        }
    }
    walk(file.template)
    // 34.3 — BOTH BLOCKS, and the reason is the SERVER. `<script module>` is request-local there
    // (34.2), so the emitted component carries its body as well as the `<script>`'s — an `await`
    // at the top of either stands in an ordinary function and the module does not parse. In a
    // browser that same block IS module scope, where the line is legal, and a source that compiles
    // on one side and not the other is the one thing this seam may not produce.
    refuseTopLevelAwait(file.modules.join('\n'), '<script module>')
    refuseTopLevelAwait(scriptsText, '<script>')
    return {
        text,
        modules,
        scripts,
        slots,
        keys,
    }
}

const AWAIT = 'await'

// 34.3 — A SCRIPT BLOCK MAY NOT AWAIT AT ITS TOP LEVEL. Component setup is a function body on both
// sides, so nothing in the render is held and every value a page reads is a hole the document is
// written around (41.4, 32.24). Refused rather than emitted: the module bun then fails to build
// names neither the page nor the line.
//
// DEPTH IS WHAT "TOP LEVEL" MEANS, and it is the whole of what this rule costs. An `await` inside a
// handler, a `reactive` body or any other function in the block is that function's own and is
// untouched — which is where 31.3's `await` operand still does its work.
function refuseTopLevelAwait(source: string, block: string): void {
    if (!source.includes(AWAIT)) return
    let depth = 0
    for (const token of tokenise(source)) {
        const text = token.text
        if (text === '{' || text === '(' || text === '[') depth += 1
        else if (text === '}' || text === ')' || text === ']') depth -= 1
        else if (depth === 0 && text === AWAIT)
            throw new Error(
                `abide: a ${block} cannot await at its top level — setup is a function body, and nothing holds the render. Await inside a handler or a reactive body, or read the value and let the position fill. RULEBOOK 34.3.`,
            )
    }
}
