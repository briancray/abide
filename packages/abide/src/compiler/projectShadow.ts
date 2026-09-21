import type { AbideFile } from './parseAbide.ts'
import type { TemplateNode } from './TemplateNode.ts'

export type Span = { start: number; end: number }

// A `.abide` FILE AS ONE TYPESCRIPT PROGRAM: its `<script module>`, its `<script>`, and every
// expression its template holds, each where the scopes it stands in are. The checker reads this
// text and answers, per occurrence, which binding a name reaches (31.3) — and the emitters lower
// the same text, span by span, so an offset means one thing on both sides.
//
// 31.13 FALLS OUT OF THE SHAPE. A `{#for}` is a `for … of` binding its item and its index, so the
// body's slots reach the row's binding and never the page's name of the same spelling. The SUBJECT
// stands before the loop, because 31.13's shadow does not reach it.
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
    text += file.scripts.join('\n')
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
    return { text, modules, scripts, slots, keys }
}
