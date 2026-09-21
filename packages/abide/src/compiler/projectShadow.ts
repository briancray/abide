import { SyntaxKind } from 'typescript/unstable/ast'
import type { AbideFile } from './parseAbide.ts'
import type { TemplateNode } from './TemplateNode.ts'
import { type Token, tokenise } from './tokenise.ts'

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
// 31.8 — ONE `const x = await foo` AT A `<script>`'s TOP LEVEL. The keyword is BLANKED in `text`,
// and that is what makes the clause answerable at all: a `Reactive` is thenable (1.4), so with the
// `await` left in place TypeScript types the binding as `Awaited<Reactive<T>>` — the value — and
// every read of the name below would then lower as written and render `[object Object]`. Blanked,
// the checker sees `const x = foo()` and answers `Reactive<T>`, which is what 31.8 says the `await`
// answers.
//
// BLANKED RATHER THAN CUT, because every span in this projection is an offset both emitters lower
// by. Five spaces where `await` stood keeps all of them.
//
// AND RESTORED WHERE THE OPERAND WAS NOT A `Reactive` — `const rows = await fetch(url)` is an
// ordinary promise and the clause does not reach it. Only the checker can tell the two apart, so
// the restore is a splice `TypeSession` pushes, and this is the one place that knows where to put
// it back.
export type ScriptAwait = {
    // The name the declaration binds — what the barrier that discharges it awaits.
    name: string
    // Where `await` stood, now five spaces.
    keyword: Span
}

export type Projection = {
    text: string
    modules: Span
    scripts: Span
    awaits: ScriptAwait[]
    // Whether the `<script>` holds a top-level `await` of ANY shape — the blanked declarations
    // above, and every other one left exactly as written. 31.9's render is held either way, so
    // this is what decides that the emitted component is `async` (35.5).
    holds: boolean
    // Where a barrier that nothing forced earlier goes: 31.9 holds the render, so the last thing
    // the script does is wait. INSIDE the scripts span rather than at its end — `lower` walks the
    // reads STRICTLY inside a span, so an insertion at `scripts.end` is one it never reaches — and
    // the newline it sits on is appended for exactly that. Meaningless where `awaits` is empty,
    // which is the only case nothing reads it.
    barrier: number
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
    const held = blankAwaits(file.scripts.join('\n'), scriptsStart)
    // THE NEWLINE IS THE BARRIER'S SEAT and is added only where one is due. `holds` is the wider
    // question — `for await (… of …)` makes the component `async` and needs no barrier — and
    // appending for it put a trailing newline on every such script's lowered body.
    text += held.awaits.length === 0 ? held.source : `${held.source}\n`
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
    return {
        text,
        modules,
        scripts,
        awaits: held.awaits,
        holds: held.holds,
        barrier: scripts.end - 1,
        slots,
        keys,
    }
}

const AWAIT = 'await'
const DECLARATIONS: ReadonlySet<string> = new Set(['const', 'let', 'var'])

// The scripts with every `const x = await …` at their top level blanked, and the names that were
// bound. `at` is where this text will stand in the projection, so a span reads in the projection's
// own offsets and nothing has to add it back.
//
// DEPTH IS WHAT "TOP LEVEL" MEANS HERE. An `await` inside a function body, an object literal or a
// call belongs to that body, and the render 31.9 holds is the one this `<script>` runs in.
function blankAwaits(
    source: string,
    at: number,
): { source: string; awaits: ScriptAwait[]; holds: boolean } {
    const awaits: ScriptAwait[] = []
    if (!source.includes(AWAIT)) return { source, awaits, holds: false }
    const tokens = tokenise(source)
    let depth = 0
    let holds = false
    // The offsets to blank, ascending — applied in one pass below rather than by slicing the
    // string per hit.
    const blanks: number[] = []
    for (let at_ = 0; at_ < tokens.length; at_ += 1) {
        const token = tokens[at_] as Token
        const text = token.text
        if (text === '{' || text === '(' || text === '[') {
            depth += 1
            continue
        }
        if (text === '}' || text === ')' || text === ']') {
            depth -= 1
            continue
        }
        if (depth !== 0) continue
        if (text === AWAIT) {
            holds = true
            continue
        }
        if (!DECLARATIONS.has(text)) continue
        const name = tokens[at_ + 1]
        const assign = tokens[at_ + 2]
        const keyword = tokens[at_ + 3]
        if (
            name?.kind !== SyntaxKind.Identifier ||
            assign?.kind !== SyntaxKind.EqualsToken ||
            keyword?.text !== AWAIT
        )
            continue
        holds = true
        blanks.push(keyword.start)
        awaits.push({
            name: name.text,
            keyword: {
                start: at + keyword.start,
                end: at + keyword.start + AWAIT.length,
            },
        })
        // Past the keyword, so the `await` above does not count it a second time.
        at_ += 3
    }
    let blanked = ''
    let from = 0
    for (const start of blanks) {
        blanked += source.slice(from, start) + ' '.repeat(AWAIT.length)
        from = start + AWAIT.length
    }
    return { source: blanked + source.slice(from), awaits, holds }
}
