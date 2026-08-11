// The `html` tag: one template representation, two substrates. Every case here renders the SAME
// template both ways — to a string with `renderToString`, and to live DOM with `mount` — so the
// difference between the lanes is visible where there is one, and asserted where there is not.

import {
    classifySlots,
    escape,
    html,
    isKeyed,
    isTemplate,
    keyed,
    raw,
    state,
    type TemplateResult,
    watch,
} from 'abide'
import { renderToString } from 'abide/server'
import { container, install, keep, measureFlush, show, sleep, suite, tick } from 'abide/tests'
import { mount } from 'abide/ui'
import { button, el, LABEL, lazy, row, stage } from './dom.ts'
import { META } from './SUITES.ts'
import * as vanilla from './vanilla.ts'

install()

/** Which substrate is asking. Only the cases that COUNT their own evaluations need to know. */
type Lane = 'client' | 'server'

/** Render one template both ways, into a two-column card. Browser only — this is furniture. */
function both(host: HTMLElement, view: (lane: Lane) => TemplateResult): void {
    const grid = el('div', 'grid gap-3 md:grid-cols-2')
    const serverPane = el('div', 'rounded-lg border border-dashed border-slate-700 bg-slate-900/60 p-3')
    serverPane.append(el('div', `${LABEL} text-slate-600 mb-1`, 'server'))
    const pre = el('pre', 'font-mono text-xs text-emerald-300 whitespace-pre-wrap break-all')
    serverPane.append(pre)

    const clientPane = el('div', 'rounded-lg border border-dashed border-slate-700 bg-slate-900/60 p-3')
    clientPane.append(el('div', `${LABEL} text-slate-600 mb-1`, 'client'))
    const live = el('div', 'text-slate-100')
    clientPane.append(live)

    grid.append(serverPane, clientPane)
    host.append(grid)

    mount(live, () => view('client'))
    // The server pane re-renders inside an effect rather than once at mount: the walk calls every
    // thunk synchronously, so the same reads that subscribe the client half subscribe this. A frozen
    // snapshot went out of step with the client on the first click, which is the one thing a card
    // about "same authoring, both substrates" must not show — and on the attribute cards the markup
    // IS the claim, since a removed attribute has nothing to look at on the live side.
    let generation = 0
    watch(() => {
        // Stamped for the same reason a child part stamps what it is showing: a render is a
        // SNAPSHOT with no supersede rule of its own, so a slow one started first lands last and
        // paints the older markup over the newer.
        const mine = ++generation
        void renderToString(view('server')).then((markup) => {
            if (mine === generation) pre.textContent = markup.trim()
        })
    })
}

/**
 * Where a bench fixture lives: off the document, for the life of the page.
 *
 * A bench's arms are built when the suite object is — at module scope — so a fixture appended to the
 * document then is one nothing will ever take down. The work these arms measure is attribute and DOM
 * writing, which is identical on a detached tree.
 *
 * Built on first USE rather than at import — see `lazy`, which is here for this reason.
 */
const detached = lazy((): HTMLElement => document.createElement('div'))

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
                // Real classes, because `class="high"` paints nothing: the whole attribute is the
                // slot, so `null` strips the styling off the live button as well as the markup, and
                // the two halves of the claim are both on screen instead of only in the inspector.
                const LEVEL = {
                    high: 'rounded px-3 py-1 text-white bg-rose-600 disabled:opacity-40',
                    low: 'rounded px-3 py-1 text-white bg-slate-600 disabled:opacity-40',
                }
                // Named, so the template stays on ONE line: the server pane prints the markup as
                // authored, and a wrapped tag buries the attribute that is the whole point of it.
                const classFor = (): string | null => {
                    const current = level()
                    return current === null ? null : LEVEL[current]
                }
                both(host, () => html`<button class=${classFor} disabled=${() => disabled()}>styled</button>`)
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
            note: 'There are no listeners in a string. `@click=${fn}` is a value that IS the function, never a thunk producing one — which is why the client does not wrap it in an effect. The binding attaches ONE listener for the life of the element and swaps the handler behind it by assignment: a row’s handler closes over its item and is therefore a fresh function on every reconcile, so comparing identities meant a detach and an attach per row per update.',
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

                // The handler is a FRESH function every patch, which is the case that used to churn.
                // Counted rather than clicked: re-attaching produces identical behaviour, so a click
                // test passes either way.
                const patch = state(0)
                const rows = container()
                mount(
                    rows,
                    () =>
                        html`<ul>
                            ${() =>
                                [1, 2, 3].map((n) => {
                                    const bump = (): void => {
                                        clicks += n + patch()
                                    }
                                    return html`<li @click=${bump}>r</li>`
                                })}
                        </ul>`,
                )
                await tick()
                const work = await measureFlush(() => patch.set(1))
                is('three rows re-rendered, no listener touched', work.addListener + work.removeListener, 0)
                ;(rows.querySelectorAll('li')[2] as HTMLElement).click()
                is('…and the NEWEST handler is the one that ran', clicks, 6)
                rows.remove()
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
            title: 'ref slots — the NODE itself, client only',
            note: '`&ref=${x}` hands over the element. A cell takes it through `set`; a function is a handler whose RETURN is its teardown — the contract `watch` already has, rather than a second lifecycle spelling. Like an event, the value IS the function: a slot kind that answered "is a function a thunk?" with an exception list per call site left this one calling the handler with no arguments.',
            async run({ is }) {
                const node = state<Element | null>(null)
                is(
                    'server emits nothing — there are no nodes there',
                    await renderToString(html`<p &ref=${node}>x</p>`),
                    '<p>x</p>',
                )

                const host = container()
                mount(host, () => html`<p &ref=${node}>x</p>`)
                is('a cell is handed the element', node()?.tagName, 'P')
                host.remove()

                // A handler's teardown belongs to the INSTANCE, not to one update: a patch that
                // re-runs an unrelated slot must not tear the ref down, and disposing must.
                const events: string[] = []
                const beat = state(0)
                const refHost = container()
                const mounted = mount(
                    refHost,
                    () =>
                        html`<p
                            &ref=${() => {
                                events.push('attach')
                                return () => events.push('teardown')
                            }}
                        >
                            ${() => beat()}
                        </p>`,
                )
                is('handler ran once', events, ['attach'])
                beat.set(1)
                await tick()
                is('a patch does NOT tear it down', events, ['attach'])
                mounted.dispose()
                is('disposing does', events, ['attach', 'teardown'])
                refHost.remove()
            },
            interact({ host, log }) {
                const node = state<Element | null>(null)
                both(host, () => html`<p class="text-slate-100" &ref=${node}>the element this cell holds</p>`)
                host.append(
                    row(
                        button('read the ref', () =>
                            log.live(
                                'node',
                                `${node()?.tagName ?? 'null'} · ${node()?.textContent?.trim() ?? ''}`,
                            ),
                        ),
                    ),
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
            interact({ host, log }) {
                const text = state('typed by the cell')
                both(
                    host,
                    () => html`<input class="rounded bg-slate-800 px-2 py-1" .value=${() => text()} />`,
                )
                // The property moves and the attribute never does — and neither half of that is
                // visible on an input, whose displayed text is the property and whose markup pane
                // shows the tag it was never written into.
                const report = async (): Promise<void> => {
                    await sleep(0)
                    const node = host.querySelector('input') as HTMLInputElement
                    log.live('the PROPERTY, .value', node.value === '' ? '(empty string)' : node.value)
                    log.live(
                        'the attribute',
                        node.hasAttribute('value') ? node.getAttribute('value') : '(never written)',
                    )
                }
                host.append(
                    row(
                        button('text.set("hello")', () => {
                            text.set('hello')
                            void report()
                        }),
                        button('text.set("")', () => {
                            text.set('')
                            void report()
                        }),
                    ),
                )
                void report()
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
                // Counted per lane, because both panes run this body: the client builds the template
                // ONCE and re-runs the thunk slot per write, while every server render is a fresh
                // snapshot that calls both. One shared counter reported the sum and read as though
                // the static slot had re-evaluated.
                const evaluations = { client: { static: 0, thunk: 0 }, server: { static: 0, thunk: 0 } }
                // A plain call, evaluated once when the template is BUILT…
                const readStatic = (lane: Lane): number => {
                    evaluations[lane].static++
                    return n.peek()
                }
                // …and a thunk, which the client wraps in an effect and re-runs per write.
                const readThunk = (lane: Lane): (() => number) => {
                    return () => {
                        evaluations[lane].thunk++
                        return n()
                    }
                }
                both(host, (lane) => html`<p>static: ${readStatic(lane)} · thunk: ${readThunk(lane)}</p>`)
                const report = (): void => {
                    log.live(
                        'client — static / thunk',
                        `${evaluations.client.static} / ${evaluations.client.thunk}`,
                    )
                    log.live(
                        'server — a fresh render calls both',
                        `${evaluations.server.static} / ${evaluations.server.thunk}`,
                    )
                }
                host.append(
                    row(
                        button('n.set(n + 1)', async () => {
                            n.set(n.peek() + 1)
                            await sleep(0)
                            report()
                        }),
                    ),
                )
                report()
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
                const shown = (): string => host.querySelector('p')?.textContent?.trim() ?? ''
                both(
                    host,
                    () =>
                        html`<p>
                            ${() => {
                                // Read the cell SYNCHRONOUSLY, before handing back the promise.
                                // Reading it inside the `.then` would run 500ms later, outside the
                                // tracking context — the slot would subscribe to nothing at all.
                                const current = seed()
                                // Odd seeds are the slow load, even ones the fast one that
                                // supersedes it — so every click is a fresh round rather than a
                                // replay that ends on the text already there.
                                const slow = current % 2 === 1
                                return sleep(slow ? 900 : 120).then(() => {
                                    // The discard is the ABSENCE of a paint, so the log has to say
                                    // what the pane reads AFTER each settle lands. The slow one
                                    // reports last and the pane is still showing the fast answer.
                                    // A macrotask, not a microtask: the binder paints from the same
                                    // promise chain, so a microtask here reads the pane one write
                                    // early and every line would name the PREVIOUS answer. `live`,
                                    // because BOTH substrates run this body — one line per seed, not
                                    // one per lane.
                                    setTimeout(() =>
                                        log.live(
                                            `seed ${current} settled (${slow ? 900 : 120}ms)`,
                                            `the client pane reads “${shown()}”`,
                                        ),
                                    )
                                    return `settled for seed ${current}`
                                })
                            }}
                        </p>`,
                )
                let round = 0
                host.append(
                    row(
                        button('one slow load, then a fast one', () => {
                            round++
                            seed.set(round * 2 - 1) // the 900ms one…
                            setTimeout(() => seed.set(round * 2), 50) // …superseded by a 120ms one
                        }),
                    ),
                )
            },
        },

        {
            title: 'a thunk handing back a CELL is read one step further',
            note: "`${() => search({ q: filter() })}` needs no trailing `()`. Cells are recognised by a registry-symbol brand, not by being callable — so neither substrate imports the reactive graph to spot one, and a plain function passed to a `.prop` slot is still a plain function. EVERY slot kind reads that step, not just child slots: an attribute that read one step short rendered the cell's own source text where the client rendered its value.",
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

                // The same step, in the two slot kinds that are NOT a child — and asserted against
                // the server, because a lane that reads one step short is a hydration mismatch.
                const cls = state('big')
                const attrs = state<Record<string, unknown>>({ id: 'x', hidden: true })
                const attrHost = container()
                mount(attrHost, () => html`<div class=${() => cls}>a</div>`)
                is('attribute slot, client', attrHost.querySelector('div')?.getAttribute('class'), 'big')
                is(
                    'attribute slot, server',
                    await renderToString(html`<div class=${() => cls}>a</div>`),
                    '<div class="big">a</div>',
                )
                attrHost.remove()

                const spreadHost = container()
                mount(spreadHost, () => html`<div ...=${() => attrs}>a</div>`)
                is(
                    'spread slot, client',
                    spreadHost.querySelector('div')?.outerHTML,
                    '<div id="x" hidden="">a</div>',
                )
                is(
                    'spread slot, server',
                    await renderToString(html`<div ...=${() => attrs}>a</div>`),
                    '<div id="x" hidden>a</div>',
                )
                spreadHost.remove()
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
                // One shape for every slot: a child carries the two fields empty rather than omitting
                // them, so the cached array the server re-walks per instantiation holds one type.
                is('slot 4 — outside the tag now', kinds[4], { kind: 'child', name: '', staticTail: 0 })
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
                    const SAME = { class: 'row', title: 'a', 'data-a': 1, 'data-b': 2 }
                    // Detached, like every other bench fixture in this repo — see `hydrate.ts`.
                    // Anything put in the document here would be in it for the life of the page:
                    // `bun test` never sees it, and a browser card would show it unstyled under the
                    // last card forever. Setting an attribute is the same work off-document, which is
                    // what this arm measures.
                    //
                    // Built by `prepare` and not here, because HERE is module scope — the suite object
                    // is built when the module is imported, and this module is imported on the server
                    // too, where there is no document to make any of it in.
                    let plain: HTMLElement | null = null
                    const ready = (): void => {
                        if (plain !== null) return
                        const host = document.createElement('div')
                        detached().append(host)
                        mount(host, () => html`<i ...=${() => props()}>x</i>`)
                        plain = document.createElement('i')
                        detached().append(plain)
                    }
                    return [
                        {
                            label: 'abide — a fresh object with the SAME names and values',
                            prepare: ready,
                            run: () => props.set({ ...SAME }),
                        },
                        {
                            label: 'vanilla — setAttribute per name, unguarded',
                            prepare: ready,
                            run: () => {
                                const node = plain as HTMLElement
                                for (const name in SAME) {
                                    node.setAttribute(name, String(SAME[name as keyof typeof SAME]))
                                }
                            },
                        },
                    ]
                })(),
            },
        },

        {
            title: 'a keyed row and an unkeyed one cannot claim the SAME row',
            note: 'A list reconciles unkeyed items by INDEX and keyed ones by key, and both look in the rows the last pass left. Nothing stopped one row answering both — an unkeyed item taking `previous[i]` while a keyed item took that very row out of the key index — after which the list held one row object at two positions and the placement walk moved its nodes twice, rendering one row where two were asked for.',
            async run({ is }) {
                // ONE call site for every row, so they share a `strings` identity — that is what
                // makes a previous row a candidate for reuse at all, and two literals written out
                // separately would never have collided.
                const li = (text: string): TemplateResult => html`<li>${text}</li>`
                const items = state<unknown[]>([keyed('k', li('first'))])
                const host = container()
                const view = mount(host, () => html`<ul>${() => items()}</ul>`)
                try {
                    is('one row to begin with', host.querySelectorAll('li').length, 1)

                    // The brand the list reconciles by, and the pair it sits in: `isKeyed` and
                    // `isTemplate` are how both substrates tell the three child-slot shapes apart
                    // without a type-checker. A keyed row is NOT a template — it wraps one — which
                    // is exactly the distinction the reconcile above depends on.
                    const row = keyed('k', li('x'))
                    is('a keyed row carries the brand', isKeyed(row), true)
                    is('…and is not itself a template', isTemplate(row), false)
                    is('a plain template is the other way round', isKeyed(li('x')), false)
                    is('…and is one', isTemplate(li('x')), true)

                    // The unkeyed item lands at index 0, where the keyed row already is, and the
                    // keyed one asks for that same row by key. Same template, so both would match it.
                    items.set([li('plain'), keyed('k', li('second'))])
                    await tick()

                    is('both rows are on screen', host.querySelectorAll('li').length, 2)
                    is(
                        'and each holds its own value',
                        Array.from(host.querySelectorAll('li')).map((li) => li.textContent),
                        ['plain', 'second'],
                    )
                } finally {
                    view.dispose()
                    host.remove()
                }
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
                const listOf = (rows: TemplateResult[]): TemplateResult => html`<ul>${rows}</ul>`

                // `createElement` fires when a call site is PREPARED — the scan and the `<template>`
                // parse — and that happens once per process. So both call sites are warmed here,
                // and the measured mount below starts from where the second row of any real list
                // starts. Without this the case would price the first instantiation, which is the
                // one instantiation that legitimately parses.
                const warm = container()
                mount(warm, () => listOf([rowOf(0)]))
                warm.remove()

                const built: TemplateResult[] = []
                for (let i = 0; i < 500; i++) built.push(rowOf(i))

                const identities = new Set(built.map((result) => result.strings))
                is('500 rows from one call site', built.length, 500)
                // The premise, not the claim: one `strings` object per call site is what the language
                // guarantees. What abide owes is caching the parse on that identity, and only the
                // counter below can say it did.
                is('distinct `strings` identities', identities.size, 1)

                const host = container()
                const work = await measureFlush(() => void mount(host, () => listOf(built)))
                is('and they all rendered', host.querySelectorAll('li').length, 500)
                // The claim. An implementation that re-scanned and re-parsed per instantiation
                // renders the same 500 rows and scores 500 here.
                is('500 more instantiations parsed nothing', work.createElement, 0)
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
                const built: TemplateResult[] = []
                for (let i = 0; i < 500; i++) built.push(rowOf(i))
                mount(list, () => html`${built}`)
                log('500 rows from one call site', built.length)
                log('distinct `strings` identities', new Set(built.map((r) => r.strings)).size)
            },
        },
    ],
})
