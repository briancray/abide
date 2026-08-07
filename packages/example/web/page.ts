// Renders one suite as a page of cards.
//
// The card runs the case's `run` — the same body `bun test` runs — and paints every line it logs,
// with assertions in green and a failure in red. Then it runs `interact`, which is the half a test
// cannot have: the buttons and inputs that need a person.
//
// Deliberately hand-written DOM, like `demos/dom.ts`: the page that shows the renderer off must not
// depend on the renderer, or a bug in `$ui` takes its own demonstration off the air.

import { type Case, context, type LogLine, type Sink, type Suite } from 'abide/tests'
import { el, LABEL } from '../demos/dom.ts'
import { NAV } from '../demos/SUITES.ts'

export function page(suite: Suite): Promise<void> {
    const root = shell(suite.title, suite.blurb, `/${suite.name === 'overview' ? '' : suite.name}`)
    const starts: (() => Promise<void>)[] = []
    for (const spec of suite.cases) {
        const built = card(spec)
        root.append(built.node)
        starts.push(built.start)
    }
    if (suite.name === 'overview') root.append(guide())

    // Every card is laid out first, then the cases run ONE AT A TIME — the order `bun test` runs them
    // in, and the only order their measurements are true in. The DOM counters are global and a
    // `measureFlush` window is a few microtasks wide, so a case started concurrently has its log
    // lines and its own DOM work billed to whichever case is measuring: `a write costs one text
    // write` read 25, and drifted between loads. The promise is for the page TEST, which needs to
    // know when the last card is done; the browser pages ignore it.
    return (async () => {
        for (const start of starts) await start()
    })()
}

// --- the page shell ---------------------------------------------------------

// `width` so the bench page can lay four columns out without crushing them; a page of prose keeps
// the narrower measure.
function shell(title: string, blurb: string, here: string, width = 'max-w-5xl'): HTMLElement {
    document.title = `${title} — abide`
    const header = el('header', 'border-b border-slate-800 bg-slate-950/80 sticky top-0 z-10 backdrop-blur')
    const bar = el('div', `mx-auto ${width} px-6 py-3 flex flex-wrap items-baseline gap-x-4 gap-y-2`)
    bar.append(el('a', 'text-slate-100 font-semibold mr-2', 'abide', { href: '/' }))
    for (const entry of NAV) {
        if (entry.name === 'overview') continue
        const href = `/${entry.name}`
        bar.append(
            el(
                'a',
                href === here
                    ? 'text-sm text-sky-300 underline underline-offset-4'
                    : 'text-sm text-slate-400 hover:text-slate-200',
                entry.name === 'template' ? 'html' : entry.name,
                { href },
            ),
        )
    }
    bar.append(
        el(
            'a',
            here === '/bench'
                ? 'text-sm text-sky-300 underline underline-offset-4'
                : 'text-sm text-slate-400 hover:text-slate-200',
            'bench',
            { href: '/bench' },
        ),
    )
    header.append(bar)

    const intro = el('div', `mx-auto ${width} px-6 pt-10 pb-2`)
    intro.append(el('h1', 'text-3xl font-semibold text-slate-100', title))
    intro.append(el('p', 'mt-2 text-slate-400 max-w-3xl', blurb))

    const main = el('main', `mx-auto ${width} px-6 pb-24 space-y-6`)
    document.body.className = 'bg-slate-900 text-slate-300 antialiased min-h-screen'
    document.body.replaceChildren(header, intro, main)
    return main
}

// --- one card ---------------------------------------------------------------

const LINE_COLOUR: Record<LogLine['kind'], string> = {
    note: 'text-emerald-300',
    pass: 'text-emerald-400',
    fail: 'text-rose-400',
}

function card(spec: Case): { node: HTMLElement; start: () => Promise<void> } {
    const node = el('section', 'rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden')
    const head = el('div', 'px-5 pt-4 pb-3')
    const title = el('div', 'flex items-baseline justify-between gap-4')
    title.append(el('h2', 'text-lg font-medium text-slate-100', spec.title))
    const status = el('span', `${LABEL} text-slate-600`, badge(spec))
    title.append(status)
    head.append(title)
    if (spec.note !== undefined) head.append(el('p', 'mt-1 text-sm text-slate-400', spec.note))

    const host = el('div', 'px-5 pb-4 space-y-3 text-slate-200')
    const console_ = el(
        'div',
        'px-5 py-3 border-t border-slate-800 bg-black/40 font-mono text-xs text-slate-400 ' +
            'space-y-0.5 max-h-64 overflow-auto',
    )
    node.append(head, host, console_)
    if (spec.run !== undefined) node.append(source('the assertions', spec.run))
    if (spec.interact !== undefined) node.append(source('the interactive half', spec.interact))

    const at = new Map<string, HTMLElement>()
    const write = (line: LogLine, live: boolean): void => {
        const rendered = renderLine(line)
        if (!live) {
            console_.append(rendered)
        } else {
            const existing = at.get(line.label)
            // Track the node that is now IN the document. Re-reading `lastElementChild` pointed at
            // whatever line happened to be last, so two live labels swapped rows from the second
            // update onward and each showed the other's value.
            if (existing !== undefined) existing.replaceWith(rendered)
            else console_.append(rendered)
            at.set(line.label, rendered)
        }
        console_.scrollTop = console_.scrollHeight
    }
    const sink: Sink = { line: (line) => write(line, false), live: (line) => write(line, true) }
    const ctx = context(host, sink)

    // `run` first, because its assertions are the claim; `interact` second, because it is the part
    // that needs a person. A failed assertion stops the case exactly as it stops the test. Both are
    // awaited by the caller: `interact` paints its own furniture, and that is DOM work the next
    // case's counters must not see.
    const start = async (): Promise<void> => {
        try {
            if (spec.run !== undefined) {
                await spec.run(ctx)
                status.textContent = 'passing'
            }
            status.className = `${LABEL} text-emerald-500`
            spec.interact?.(ctx)
        } catch (error: unknown) {
            status.textContent = 'FAILED'
            status.className = `${LABEL} text-rose-400`
            write({ label: 'the case threw', value: String(error), kind: 'fail' }, false)
        }
    }

    return { node, start }
}

function badge(spec: Case): string {
    if (spec.run !== undefined) return 'running…'
    return spec.bench !== undefined ? 'benched — see /bench' : 'interactive'
}

function renderLine(line: LogLine): HTMLElement {
    const node = el('div', 'flex gap-3')
    node.append(el('span', 'text-slate-500 shrink-0 w-56 truncate', line.label === '' ? ' ' : line.label))
    if (line.value !== '') {
        node.append(el('span', `${LINE_COLOUR[line.kind]} whitespace-pre-wrap break-all`, line.value))
    }
    return node
}

// `Function.prototype.toString` means the source on screen IS the source that ran, so the two cannot
// drift — and the reader can check the claim against the code that makes it.
function source(label: string, fn: (...args: never[]) => unknown): HTMLElement {
    const wrap = el('details', 'border-t border-slate-800 bg-slate-950')
    wrap.append(
        el(
            'summary',
            'px-5 py-2 text-xs text-slate-500 cursor-pointer select-none hover:text-slate-300',
            label,
        ),
    )
    const pre = el('pre', 'px-5 pb-4 overflow-auto max-h-96 text-xs leading-relaxed text-slate-300')
    pre.append(highlight(dedent(fn.toString())))
    wrap.append(pre)
    return wrap
}

function dedent(source_: string): string {
    const lines = source_.split('\n')
    let indent = Infinity
    for (let i = 1; i < lines.length; i++) {
        const text = lines[i] as string
        if (text.trim() === '') continue
        indent = Math.min(indent, text.length - text.trimStart().length)
    }
    if (!Number.isFinite(indent) || indent === 0) return source_
    for (let i = 1; i < lines.length; i++) lines[i] = (lines[i] as string).slice(indent)
    return lines.join('\n')
}

// --- syntax colouring -------------------------------------------------------
//
// A hand-written scanner, for the same reason `demos/dom.ts` is hand-written: the page that shows
// abide off carries no machinery of its own, and the grammar it has to cover is the subset a demo
// body is written in. Code indentation is the bundler's — see `development` in `serve.ts` — and the
// only thing re-indented is the inside of a multi-line template, which the bundler cannot touch. See
// `outdent`.
//
// Template literals get a stack rather than a flag: `html` bodies nest one inside another's `${}`,
// and a flag colours everything after the inner backtick as string.

// Written as split lists rather than array literals so a word costs a word rather than a line.
const KEYWORDS = new Set(
    (
        'as async await break case catch class const continue default delete do else export extends ' +
        'finally for from function get if import in instanceof interface let new of return ' +
        'satisfies set static switch throw try type typeof var void while yield'
    ).split(' '),
)

const LITERALS = new Set('false Infinity NaN null this true undefined'.split(' '))

// A `/` after one of these opens a regex; after anything else it divides.
const BEFORE_REGEX = new Set(
    'await case delete do else in instanceof new of return typeof void yield'.split(' '),
)

// `)` and `]` are the ones deliberately absent: `(a + b) / 2` and `xs[i] / 2` are divides.
const PUNCT_BEFORE_REGEX = new Set('(,=:[!&|?{};+-*%<>~^'.split(''))

const CODE_COLOUR = {
    comment: 'text-slate-600 italic',
    string: 'text-emerald-300',
    regex: 'text-orange-300',
    number: 'text-amber-300',
    keyword: 'text-sky-400',
    literal: 'text-amber-300',
    call: 'text-violet-300',
    punct: 'text-slate-500',
}

function isSpace(ch: string): boolean {
    return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r'
}

function isWordStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$'
}

function isWord(ch: string): boolean {
    return isWordStart(ch) || (ch >= '0' && ch <= '9')
}

function highlight(code: string): DocumentFragment {
    const out = document.createDocumentFragment()
    const push = (colour: string, text: string): void => {
        if (text === '') return
        out.append(colour === '' ? document.createTextNode(text) : el('span', colour, text))
    }

    // One record per open template.
    interface Open {
        /** Brace depth it was opened at. */
        brace: number
        /** Indent of the line its backtick sits on. */
        indent: number
        /** Columns to pull its interior back by; -1 until the first interior line fixes it. */
        shift: number
    }
    const open: Open[] = []
    let braceDepth = 0
    let inTemplateText = false
    let previous = '' // last significant token, to tell a regex from a divide
    let i = 0
    const n = code.length

    // The interior of a multi-line template is the one thing the bundler leaves at its AUTHORED
    // indentation: it re-prints the statement around it at column 2, but re-printing the string would
    // change the string, so the two disagree by however deep the case was nested. Pull the interior
    // back so it sits one step in from its opening line. The first line inside the template fixes the
    // correction for every line after it, which is why no lookahead is needed.
    //
    // This is the one place the pane is not character-for-character what ran. Leading whitespace in
    // an `html` body is insignificant, and a card nobody can read demonstrates nothing.
    const outdent = (text: string, template: Open): string => {
        if (text.indexOf('\n') === -1) return text
        let result = ''
        let at = 0
        while (at < text.length) {
            const newline = text.indexOf('\n', at)
            if (newline === -1) {
                result += text.slice(at)
                break
            }
            let end = newline + 1
            while (text[end] === ' ' || text[end] === '\t') end++
            const indent = end - newline - 1
            if (template.shift === -1) template.shift = Math.max(0, indent - template.indent - 4)
            const drop = Math.min(template.shift, indent)
            result += text.slice(at, newline + 1) + text.slice(newline + 1 + drop, end)
            at = end
        }
        return result
    }

    while (i < n) {
        const ch = code[i] as string

        // the literal halves of a template, up to `${` or the closing backtick
        if (inTemplateText) {
            const template = open[open.length - 1] as Open
            let j = i
            while (j < n) {
                const c = code[j] as string
                if (c === '\\') {
                    j += 2
                    continue
                }
                if (c === '`' || (c === '$' && code[j + 1] === '{')) break
                j++
            }
            if (j < n && code[j] === '`') {
                push(CODE_COLOUR.string, outdent(code.slice(i, j + 1), template))
                open.pop()
                inTemplateText = false
                previous = '`'
                i = j + 1
            } else if (j < n) {
                push(CODE_COLOUR.string, outdent(code.slice(i, j), template))
                push(CODE_COLOUR.punct, '${')
                braceDepth++
                inTemplateText = false
                previous = '{'
                i = j + 2
            } else {
                push(CODE_COLOUR.string, outdent(code.slice(i), template))
                i = n
            }
            continue
        }

        if (isSpace(ch)) {
            let j = i + 1
            while (j < n && isSpace(code[j] as string)) j++
            push('', code.slice(i, j))
            i = j
            continue
        }

        if (ch === '/' && code[i + 1] === '/') {
            let j = i + 2
            while (j < n && code[j] !== '\n') j++
            push(CODE_COLOUR.comment, code.slice(i, j))
            i = j
            continue
        }

        if (ch === '/' && code[i + 1] === '*') {
            const end = code.indexOf('*/', i + 2)
            const j = end === -1 ? n : end + 2
            push(CODE_COLOUR.comment, code.slice(i, j))
            i = j
            continue
        }

        if (ch === '"' || ch === "'") {
            let j = i + 1
            while (j < n && code[j] !== ch) j += code[j] === '\\' ? 2 : 1
            j = j < n ? j + 1 : n
            push(CODE_COLOUR.string, code.slice(i, j))
            previous = '"'
            i = j
            continue
        }

        if (ch === '`') {
            const lineStart = code.lastIndexOf('\n', i - 1) + 1
            let openIndent = 0
            while (code[lineStart + openIndent] === ' ' || code[lineStart + openIndent] === '\t') {
                openIndent++
            }
            open.push({ brace: braceDepth, indent: openIndent, shift: -1 })
            push(CODE_COLOUR.string, '`')
            inTemplateText = true
            i++
            continue
        }

        // a regex only where an expression can start — a character class holds `/` and quotes, so
        // reading `/[&<>"']/g` as a divide starts a string that never closes
        if (
            ch === '/' &&
            (previous === '' || BEFORE_REGEX.has(previous) || PUNCT_BEFORE_REGEX.has(previous))
        ) {
            let j = i + 1
            let inClass = false
            while (j < n) {
                const c = code[j] as string
                if (c === '\\') {
                    j += 2
                    continue
                }
                if (c === '\n') break
                if (c === '[') inClass = true
                else if (c === ']') inClass = false
                else if (c === '/' && !inClass) break
                j++
            }
            if (j < n && code[j] === '/') {
                j++
                while (j < n && isWord(code[j] as string)) j++
                push(CODE_COLOUR.regex, code.slice(i, j))
                previous = '/re/'
                i = j
                continue
            }
        }

        if (ch >= '0' && ch <= '9') {
            let j = i + 1
            while (j < n && (isWord(code[j] as string) || code[j] === '.')) j++
            push(CODE_COLOUR.number, code.slice(i, j))
            previous = '0'
            i = j
            continue
        }

        if (isWordStart(ch)) {
            let j = i + 1
            while (j < n && isWord(code[j] as string)) j++
            const word = code.slice(i, j)
            let after = j
            while (after < n && isSpace(code[after] as string)) after++
            let colour = ''
            if (KEYWORDS.has(word) && previous !== '.') colour = CODE_COLOUR.keyword
            else if (LITERALS.has(word) && previous !== '.') colour = CODE_COLOUR.literal
            else if (code[after] === '(') colour = CODE_COLOUR.call
            push(colour, word)
            previous = word
            i = j
            continue
        }

        if (ch === '{') braceDepth++
        else if (ch === '}') {
            braceDepth--
            if (open.length > 0 && (open[open.length - 1] as Open).brace === braceDepth) {
                push(CODE_COLOUR.punct, '}')
                inTemplateText = true
                previous = '}'
                i++
                continue
            }
        }
        push(CODE_COLOUR.punct, ch)
        previous = ch
        i++
    }

    return out
}

// --- the hub's index --------------------------------------------------------

function guide(): HTMLElement {
    const grid = el('div', 'grid gap-3 sm:grid-cols-2')
    for (const entry of NAV) {
        if (entry.name === 'overview') continue
        const link = el(
            'a',
            'block rounded-xl border border-slate-800 bg-slate-950/60 p-5 hover:border-slate-600 transition-colors',
            '',
            { href: `/${entry.name}` },
        )
        link.append(el('h3', 'text-base font-medium text-slate-100', entry.title))
        link.append(el('p', 'mt-1 text-xs uppercase tracking-widest text-slate-600', entry.tag))
        link.append(el('p', 'mt-2 text-sm text-slate-400', entry.blurb))
        grid.append(link)
    }
    const bench = el(
        'a',
        'block rounded-xl border border-slate-800 bg-slate-950/60 p-5 hover:border-slate-600 transition-colors',
        '',
        { href: '/bench' },
    )
    bench.append(el('h3', 'text-base font-medium text-slate-100', 'bench'))
    bench.append(el('p', 'mt-1 text-xs uppercase tracking-widest text-slate-600', 'vs hand-written'))
    bench.append(
        el(
            'p',
            'mt-2 text-sm text-slate-400',
            'Every case above that carries a bench, against a hand-written equivalent: time as a ' +
                'ratio, work as DOM calls, and reactivity as wake-ups.',
        ),
    )
    grid.append(bench)
    return grid
}

export { highlight, shell }
