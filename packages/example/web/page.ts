// Renders one suite as a page of cards.
//
// The card runs the case's `run` — the same body `bun test` runs — and paints every line it logs,
// with assertions in green and a failure in red. Then it runs `interact`, which is the half a test
// cannot have: the buttons and inputs that need a person.
//
// Deliberately hand-written DOM, like `demos/dom.ts`: the page that shows the renderer off must not
// depend on the renderer, or a bug in `$ui` takes its own demonstration off the air.

import { type Case, context, type LogLine, type Sink, type Suite } from '$tests'
import { el } from '../demos/dom.ts'
import { NAV } from '../demos/SUITES.ts'

export function page(suite: Suite): void {
    const root = shell(suite.title, suite.blurb, `/${suite.name === 'overview' ? '' : suite.name}`)
    for (const spec of suite.cases) root.append(card(spec))
    if (suite.name === 'overview') root.append(guide())
}

// --- the page shell ---------------------------------------------------------

function shell(title: string, blurb: string, here: string): HTMLElement {
    document.title = `${title} — abide`
    const header = el('header', 'border-b border-slate-800 bg-slate-950/80 sticky top-0 z-10 backdrop-blur')
    const bar = el('div', 'mx-auto max-w-5xl px-6 py-3 flex flex-wrap items-baseline gap-x-4 gap-y-2')
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

    const intro = el('div', 'mx-auto max-w-5xl px-6 pt-10 pb-2')
    intro.append(el('h1', 'text-3xl font-semibold text-slate-100', title))
    intro.append(el('p', 'mt-2 text-slate-400 max-w-3xl', blurb))

    const main = el('main', 'mx-auto max-w-5xl px-6 pb-24 space-y-6')
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

function card(spec: Case): HTMLElement {
    const node = el('section', 'rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden')
    const head = el('div', 'px-5 pt-4 pb-3')
    const title = el('div', 'flex items-baseline justify-between gap-4')
    title.append(el('h2', 'text-lg font-medium text-slate-100', spec.title))
    const status = el('span', 'text-[10px] uppercase tracking-widest text-slate-600', badge(spec))
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
    // that needs a person. A failed assertion stops the case exactly as it stops the test.
    const started = spec.run === undefined ? Promise.resolve() : Promise.resolve(spec.run(ctx))
    void started
        .then(() => {
            if (spec.run !== undefined) status.textContent = 'passing'
            status.className = 'text-[10px] uppercase tracking-widest text-emerald-500'
            spec.interact?.(ctx)
        })
        .catch((error: unknown) => {
            status.textContent = 'FAILED'
            status.className = 'text-[10px] uppercase tracking-widest text-rose-400'
            write({ label: 'the case threw', value: String(error), kind: 'fail' }, false)
        })

    return node
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
    const pre = el('pre', 'px-5 pb-4 overflow-auto text-xs leading-relaxed text-slate-400')
    pre.textContent = dedent(fn.toString())
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

export { shell }
