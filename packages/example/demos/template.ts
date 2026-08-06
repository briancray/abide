// The `html` tag: one template representation, two substrates. Every case here renders the SAME
// template both ways — to a string with `renderToString`, and to live DOM with `mount` — so the
// difference between the lanes is visible where there is one, and asserted where there is not.

import { classifySlots, escape, html, isTemplate, raw, state, type TemplateResult } from 'abide'
import { renderToString } from 'abide/server'
import { mount } from 'abide/ui'
import { container, install, keep, measureFlush, show, sleep, suite, tick } from '$tests'
import { button, el, row, stage } from './dom.ts'
import { META } from './SUITES.ts'
import * as vanilla from './vanilla.ts'

install()

/** Render one template both ways, into a two-column card. Browser only — this is furniture. */
function both(host: HTMLElement, view: () => TemplateResult): void {
    const grid = el('div', 'grid gap-3 md:grid-cols-2')
    const serverPane = el('div', 'rounded-lg border border-dashed border-slate-700 bg-slate-900/60 p-3')
    serverPane.append(el('div', 'text-[10px] uppercase tracking-widest text-slate-600 mb-1', 'server'))
    const pre = el('pre', 'font-mono text-xs text-emerald-300 whitespace-pre-wrap break-all')
    serverPane.append(pre)

    const clientPane = el('div', 'rounded-lg border border-dashed border-slate-700 bg-slate-900/60 p-3')
    clientPane.append(el('div', 'text-[10px] uppercase tracking-widest text-slate-600 mb-1', 'client'))
    const live = el('div', 'text-slate-100')
    clientPane.append(live)

    grid.append(serverPane, clientPane)
    host.append(grid)

    mount(live, view)
    void renderToString(view()).then((markup) => (pre.textContent = markup.trim()))
}

export default suite({
    ...META.template,
    cases: [
        {
            title: 'child slots — text is escaped, on both sides',
            note: 'The server escapes into markup; the client writes a text node, which cannot be markup in the first place. Same authoring, same result.',
            async run({ is }) {
                const name = state('<script>alert(1)</script>')
                const view = (): TemplateResult => html`<p>hello ${() => name()}</p>`

                is(
                    'server',
                    await renderToString(view()),
                    '<p>hello &lt;script&gt;alert(1)&lt;/script&gt;</p>',
                )
                const host = container()
                mount(host, view)
                // The client never produced markup at all, so the text arrives as text.
                is('client', host.querySelector('p')?.textContent, 'hello <script>alert(1)</script>')
                is('and no script element was created', host.querySelector('script'), null)

                is('escape("a < b & c")', escape('a < b & c'), 'a &lt; b &amp; c')
                is('escape("plain") is the same string', escape('plain'), 'plain')
                host.remove()
            },
            bench: {
                kind: 'time',
                arms: (() => {
                    // Most interpolated text has no special characters, and `replace` with a callback
                    // allocates on every call whether it hits or not. Probing first is why the common
                    // path is free.
                    const clean = 'a perfectly ordinary row label'
                    // …and the other half of the claim. A probe that is free on a miss has to be
                    // paid for on a HIT, and one arm cannot show both: measured only on clean text,
                    // an implementation that probed twice would read exactly the same.
                    const dirty = 'a <b>row</b> label & then some'
                    return [
                        { label: 'abide — escape() (probes first)', run: () => keep(escape(clean)) },
                        {
                            label: 'vanilla — the same probe',
                            run: () => keep(vanilla.escapeHtml(clean)),
                        },
                        {
                            label: 'vanilla — replace unconditionally',
                            run: () => keep(vanilla.escapeAlways(clean)),
                        },
                        {
                            label: 'abide — escape() on text that DOES need it',
                            run: () => keep(escape(dirty)),
                        },
                        {
                            label: 'vanilla — replace unconditionally, same text',
                            run: () => keep(vanilla.escapeAlways(dirty)),
                        },
                    ]
                })(),
            },
            interact({ host }) {
                const name = state('<script>alert(1)</script>')
                both(host, () => html`<p>hello ${() => name()}</p>`)
                host.append(
                    row(
                        button('name.set("ada & grace")', () => name.set('ada & grace')),
                        button('name.set(the script tag)', () => name.set('<script>alert(1)</script>')),
                    ),
                )
            },
        },

        {
            title: 'attribute slots — nullish and false OMIT, true goes bare',
            note: 'Written unquoted: `class=${x}`, never `class="${x}"`. The slot owns the `name=` before it, which is why the classifier records a `staticTail` to strip.',
            async run({ is }) {
                is(
                    'server',
                    await renderToString(
                        html`<a href=${'/x'} hidden=${true} rel=${null} down=${false}>go</a>`,
                    ),
                    '<a href="/x" hidden>go</a>',
                )

                const level = state<'high' | null>('high')
                const disabled = state(true)
                const host = container()
                mount(
                    host,
                    () => html`<button class=${() => level()} disabled=${() => disabled()}>go</button>`,
                )
                const node = host.querySelector('button') as HTMLButtonElement
                is('client — class', node.getAttribute('class'), 'high')
                is('client — a true attribute is bare', node.getAttribute('disabled'), '')

                level.set(null)
                disabled.set(false)
                await tick()
                is('null REMOVES it', node.hasAttribute('class'), false)
                is('false removes it too', node.hasAttribute('disabled'), false)
                host.remove()
            },
            interact({ host }) {
                const level = state<'high' | 'low' | null>('high')
                const disabled = state(true)
                both(
                    host,
                    () => html`<button class=${() => level()} disabled=${() => disabled()}>styled</button>`,
                )
                host.append(
                    row(
                        button('level: high / low / null', () =>
                            level.set(
                                level.peek() === 'high' ? 'low' : level.peek() === 'low' ? null : 'high',
                            ),
                        ),
                        button('toggle disabled', () => disabled.set(!disabled.peek())),
                    ),
                )
            },
        },

        {
            title: 'event slots — client only; the server emits nothing',
            note: 'There are no listeners in a string. `@click=${fn}` is a value that IS the function, never a thunk producing one — which is why the client does not wrap it in an effect.',
            async run({ is }) {
                let clicks = 0
                const label = state('go')
                const view = (): TemplateResult =>
                    html`<button @click=${() => clicks++}>${() => label()}</button>`

                is('server', await renderToString(view()), '<button>go</button>')

                const host = container()
                mount(host, view)
                const node = host.querySelector('button') as HTMLButtonElement
                node.click()
                label.set('stop') // an unrelated slot moving must not re-attach the listener
                await tick()
                node.click()
                is('both clicks landed on one listener', clicks, 2)
                is('and the other slot updated', node.textContent, 'stop')
                host.remove()
            },
            interact({ host, log }) {
                let clicks = 0
                both(
                    host,
                    () =>
                        html`<button class="rounded bg-sky-600 px-3 py-1" @click=${() => log.live('clicks', ++clicks)}>
                            click me
                        </button>`,
                )
            },
        },

        {
            title: 'property slots — a DOM property, never an attribute',
            note: 'Deliberately emits nothing on the server: a DOM property has no serialisation. Use an attribute slot when the value must survive SSR.',
            async run({ is }) {
                const text = state('typed by the cell')
                is(
                    'server emits nothing for it',
                    await renderToString(html`<input .value=${'x'} />`),
                    '<input />',
                )

                const host = container()
                mount(host, () => html`<input .value=${() => text()} />`)
                const node = host.querySelector('input') as HTMLInputElement
                is('client sets the PROPERTY', node.value, 'typed by the cell')
                is('…and not the attribute', node.hasAttribute('value'), false)
                text.set('hello')
                await tick()
                is('and it updates', node.value, 'hello')
                host.remove()
            },
            interact({ host }) {
                const text = state('typed by the cell')
                both(
                    host,
                    () => html`<input class="rounded bg-slate-800 px-2 py-1" .value=${() => text()} />`,
                )
                host.append(
                    row(
                        button('text.set("hello")', () => text.set('hello')),
                        button('text.set("")', () => text.set('')),
                    ),
                )
            },
        },

        {
            title: 'a thunk is THE reactivity convention',
            note: 'The server CALLS it; the client wraps it in an effect. Same authoring, both substrates — and it is per slot, so only that binding re-runs.',
            async run({ is }) {
                const n = state(1)
                let staticReads = 0
                let thunkReads = 0
                const readStatic = (): number => {
                    staticReads++
                    return n.peek()
                }
                const readThunk = (): number => {
                    thunkReads++
                    return n()
                }
                const view = (): TemplateResult => html`<p>static: ${readStatic()} · thunk: ${readThunk}</p>`

                is(
                    'server — a thunk is simply called',
                    await renderToString(view()),
                    '<p>static: 1 · thunk: 1</p>',
                )

                const host = container()
                staticReads = 0
                thunkReads = 0
                mount(host, view)
                is('client — both evaluated once on mount', [staticReads, thunkReads], [1, 1])

                n.set(2)
                await tick()
                is('the static slot was never re-evaluated', staticReads, 1)
                is('only the thunk slot re-ran', thunkReads, 2)
                is('the DOM', host.querySelector('p')?.textContent, 'static: 1 · thunk: 2')
                host.remove()
            },
            interact({ host, log }) {
                const n = state(1)
                let staticReads = 0
                let thunkReads = 0
                // A plain call, evaluated once when the template is BUILT…
                const readStatic = (): number => {
                    staticReads++
                    return n.peek()
                }
                // …and a thunk, which the client wraps in an effect and re-runs per write.
                const readThunk = (): number => {
                    thunkReads++
                    return n()
                }
                both(host, () => html`<p>static: ${readStatic()} · thunk: ${readThunk}</p>`)
                host.append(
                    row(
                        button('n.set(n + 1)', async () => {
                            n.set(n.peek() + 1)
                            await sleep(0)
                            log.live('static slot evaluations', staticReads)
                            log.live('thunk slot evaluations', thunkReads)
                        }),
                    ),
                )
            },
        },

        {
            title: 'nested templates and arrays compose',
            note: 'A value may be a primitive, a nested `html` template, an array, a promise, an async iterable, or `raw(...)`.',
            async run({ is }) {
                const rows = [1, 2, 3].map((n) => html`<li>row ${n}</li>`)
                is(
                    'server',
                    await renderToString(html`<ul>${rows}</ul>`),
                    '<ul><li>row 1</li><li>row 2</li><li>row 3</li></ul>',
                )

                const items = state(['alpha', 'beta'])
                const host = container()
                mount(host, () => html`<ul>${() => items().map((item) => html`<li>${item}</li>`)}</ul>`)
                is(
                    'client',
                    Array.from(host.querySelectorAll('li')).map((li) => li.textContent),
                    ['alpha', 'beta'],
                )
                items.set(['alpha', 'beta', 'gamma'])
                await tick()
                is('and it grows', host.querySelectorAll('li').length, 3)
                host.remove()
            },
            interact({ host }) {
                const items = state(['alpha', 'beta'])
                const badge = (text: string): TemplateResult =>
                    html`<span class="rounded bg-slate-800 px-2 py-0.5 text-xs">${text}</span>`
                both(
                    host,
                    () => html`<div class="flex gap-2">${() => items().map((item) => badge(item))}</div>`,
                )
                host.append(
                    row(
                        button('push', () => items.set([...items.peek(), `item${items.peek().length}`])),
                        button('pop', () => items.set(items.peek().slice(0, -1))),
                    ),
                )
            },
        },

        {
            title: 'raw — markup that is meant to be markup',
            note: 'The one escape hatch out of escaping. Everything else in a child slot is text.',
            async run({ is }) {
                const markup = raw('<em class="on-purpose">emphasis</em>')
                is(
                    'server',
                    await renderToString(html`<div>${markup}</div>`),
                    '<div><em class="on-purpose">emphasis</em></div>',
                )

                const host = container()
                mount(host, () => html`<div>${markup}</div>`)
                is('client parsed it as markup', host.querySelector('em')?.className, 'on-purpose')
                host.remove()
            },
            interact({ host }) {
                both(
                    host,
                    () => html`<div>${raw('<em class="text-amber-300">emphasis, on purpose</em>')}</div>`,
                )
            },
        },

        {
            title: 'a promise in a child slot',
            note: 'The server awaits it in place. The client keeps showing what is there until it lands — and a promise superseded before it settles is discarded rather than painted over the newer content.',
            async run({ is }) {
                is(
                    'server awaits it in place',
                    await renderToString(html`<p>${Promise.resolve('later')}</p>`),
                    '<p>later</p>',
                )

                const host = container()
                mount(host, () => html`<p>${Promise.resolve('later')}</p>`)
                is('client — blank until it lands', host.querySelector('p')?.textContent, '')
                await tick()
                is('…and then the value, not [object Promise]', host.querySelector('p')?.textContent, 'later')
                host.remove()
            },
            interact({ host, log }) {
                const seed = state(0)
                both(
                    host,
                    () =>
                        html`<p>
                            ${() => {
                                // Read the cell SYNCHRONOUSLY, before handing back the promise.
                                // Reading it inside the `.then` would run 500ms later, outside the
                                // tracking context — the slot would subscribe to nothing at all.
                                const current = seed()
                                return sleep(current === 1 ? 900 : 120).then(
                                    () => `settled for seed ${current}`,
                                )
                            }}
                        </p>`,
                )
                host.append(
                    row(
                        button('one slow load, then a fast one', () => {
                            seed.set(1) // 900ms
                            setTimeout(() => seed.set(2), 50) // …superseded by a 120ms one
                            log('watch it', 'the 900ms answer for seed 1 lands last and is discarded')
                        }),
                    ),
                )
            },
        },

        {
            title: 'a thunk handing back a CELL is read one step further',
            note: '`${() => search({ q: filter() })}` needs no trailing `()`. Cells are recognised by a registry-symbol brand, not by being callable — so neither substrate imports the reactive graph to spot one, and a plain function passed to a `.prop` slot is still a plain function.',
            async run({ is }) {
                const cell = state('a cell, not a function')
                const host = container()
                mount(host, () => html`<p>${() => cell}</p>`)
                is(
                    'the handle in the slot means its VALUE',
                    host.querySelector('p')?.textContent,
                    'a cell, not a function',
                )
                cell.set('updated')
                await tick()
                is('and it stays subscribed', host.querySelector('p')?.textContent, 'updated')
                host.remove()
            },
            interact({ host }) {
                const cell = state('a cell, not a function')
                both(host, () => html`<p>${() => cell}</p>`)
                host.append(row(button('cell.set(now)', () => cell.set(`updated at ${Date.now() % 100000}`))))
            },
        },

        {
            title: 'the classifier, shown',
            note: 'One walk over the static strings, tracking whether we are inside a tag. Quotes inside a tag are tracked so `title="a > b"` does not close it early.',
            async run({ is, log }) {
                const sample = html`<a href=${1} @click=${2} .value=${3} title="a > b" data-x=${4}>${5}</a>`
                const kinds = classifySlots(sample.strings)
                is('five slots', kinds.length, 5)
                is('slot 0', kinds[0], { kind: 'attr', name: 'href', staticTail: 6 })
                is('slot 1', kinds[1], { kind: 'event', name: 'click', staticTail: 8 })
                is('slot 2', kinds[2], { kind: 'property', name: 'value', staticTail: 8 })
                // The `>` inside the quoted title did NOT close the tag.
                is('slot 3', kinds[3], { kind: 'attr', name: 'data-x', staticTail: 8 })
                is('slot 4 — outside the tag now', kinds[4], { kind: 'child' })
                is('isTemplate(sample)', isTemplate(sample), true)
                is('isTemplate(a plain object)', isTemplate({ strings: [], values: [] }), false)
                for (const kind of kinds) log('', show(kind))
            },
        },

        {
            title: 'spread slots — the names are only known from the VALUE',
            note: 'Which attributes a `...=${props}` slot owns is not in the markup, so the previous object is the record of what to take back: anything it set and no longer names is removed. That is the one binding whose correctness is entirely a matter of what it did NOT leave behind, and a counter is the only way to see it.',
            async run({ is }) {
                is(
                    'server',
                    await renderToString(html`<a ...=${{ href: '/x', rel: null, hidden: true }}>go</a>`),
                    '<a href="/x" hidden>go</a>',
                )

                const props = state<Record<string, unknown>>({ href: '/a', title: 'first', 'data-n': 1 })
                const host = container()
                mount(host, () => html`<a ...=${() => props()}>go</a>`)
                const node = host.querySelector('a') as HTMLAnchorElement
                is('client — every name landed', node.getAttribute('title'), 'first')

                // `title` is gone from the object, so it must be gone from the element.
                const work = await measureFlush(() => props.set({ href: '/a', 'data-n': 2 }))
                is('the dropped name was REMOVED', node.hasAttribute('title'), false)
                is('…which is one removeAttribute', work.removeAttribute, 1)
                is('the moved one was written', node.getAttribute('data-n'), '2')
                is('and the unchanged one was not', work.setAttribute, 1)
                host.remove()
            },
            bench: {
                kind: 'work',
                arms: (() => {
                    const props = state<Record<string, unknown>>({
                        class: 'row',
                        title: 'a',
                        'data-a': 1,
                        'data-b': 2,
                    })
                    const host = document.createElement('div')
                    document.body.append(host)
                    mount(host, () => html`<i ...=${() => props()}>x</i>`)
                    const plain = document.createElement('i')
                    document.body.append(plain)
                    const SAME = { class: 'row', title: 'a', 'data-a': 1, 'data-b': 2 }
                    return [
                        {
                            label: 'abide — a fresh object with the SAME names and values',
                            run: () => props.set({ ...SAME }),
                        },
                        {
                            label: 'vanilla — setAttribute per name, unguarded',
                            run: () => {
                                for (const name in SAME) {
                                    plain.setAttribute(name, String(SAME[name as keyof typeof SAME]))
                                }
                            },
                        },
                    ]
                })(),
            },
        },

        {
            title: 'the two spellings that are a SyntaxError',
            note: 'A quoted slot and a slot that is only part of a value. Both raise at classify time, naming the offending text — a silent mis-parse here would be a bug you find in production markup.',
            async run({ throws }) {
                throws(
                    'a QUOTED slot',
                    () => classifySlots(html`<a href="${'x'}">quoted</a>`.strings),
                    'must be a whole attribute value',
                )
                throws(
                    'a PARTIAL value',
                    () => classifySlots(html`<a class="a ${'b'}">partial</a>`.strings),
                    'must be a whole attribute value',
                )
            },
        },

        {
            title: 'one call site parses ONCE',
            note: 'A tagged template literal produces the same `strings` array object on every evaluation, so the scan and the <template> parse are cached on its identity. Every later instantiation is a clone plus a walk.',
            async run({ is }) {
                const rowOf = (n: number): TemplateResult => html`<li class="text-sm">row ${n}</li>`
                const built: TemplateResult[] = []
                for (let i = 0; i < 500; i++) built.push(rowOf(i))

                const identities = new Set(built.map((result) => result.strings))
                is('500 rows from one call site', built.length, 500)
                is('distinct `strings` identities', identities.size, 1)

                const host = container()
                mount(host, () => html`<ul>${built}</ul>`)
                is('and they all rendered', host.querySelectorAll('li').length, 500)
                host.remove()
            },
            bench: {
                kind: 'time',
                arms: (() => {
                    // The tag captures the strings and the values and renders nothing. This is the
                    // per-row allocation budget: one object, no scan — the scan is cached on the
                    // `strings` identity a tagged template gives for free.
                    const build = (n: number): unknown => html`<li class="row">${n}</li>`
                    const plain = (n: number): unknown => ({
                        strings: ['<li class="row">', '</li>'],
                        values: [n],
                    })
                    return [
                        { label: 'abide — html`…`', run: (i: number) => keep(build(i)) },
                        { label: 'vanilla — an object literal', run: (i: number) => keep(plain(i)) },
                        {
                            label: 'vanilla — a template string',
                            run: (i: number) => keep(`<li class="row">${i}</li>`),
                        },
                    ]
                })(),
            },
            interact({ host, log }) {
                const rowOf = (n: number): TemplateResult => html`<li class="text-sm">row ${n}</li>`
                const out = stage(host)
                const list = document.createElement('ul')
                out.append(list)
                const started = performance.now()
                const built: TemplateResult[] = []
                for (let i = 0; i < 500; i++) built.push(rowOf(i))
                mount(list, () => html`${built}`)
                log('500 rows from one call site', `${(performance.now() - started).toFixed(1)}ms`)
                log('distinct `strings` identities', new Set(built.map((r) => r.strings)).size)
            },
        },
    ],
})
