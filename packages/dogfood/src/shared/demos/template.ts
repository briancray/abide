// The `html` tag: one template representation, two substrates. Every case here renders the SAME
// template both ways — to a string with `renderToString`, and to live DOM with `mount` — so the
// difference between the lanes is visible where there is one, and asserted where there is not.

import { html, memo, raw, state, type TemplateResult, watch } from 'abide'
// This suite is what tests the template runtime, so it calls what the emitter writes — and the
// predicates that read what it wrote — by hand. `raw` is not among them: it is the escape hatch an
// author types, so it comes off the front door above with `html`.
import { boundary, classifySlots, escape, isKeyed, isTemplate, keyed } from 'abide/runtime'
import { renderToString } from 'abide/server/internal'
import { mount, type Mounted } from 'abide/ui'
import { container, scratch, show, sleep, suite } from 'harness'
import { install, keep, measureFlush, tick } from 'harness/measure'
import { button, el, lazy, output, row, stage } from './dom.ts'
// The rungs the case at the bottom asserts, one mount each: what a slot MEANS is decided by where it
// sits, so a single mount over one file could not say which position each claim was about.
import Attribute from './fixtures/template/02-an-attribute.abide'
import Accessors from './fixtures/template/12-bind-an-accessor-pair.abide'
import Toggle from './fixtures/template/13-a-class-toggle.abide'
import Trusted from './fixtures/template/17-trust-a-string-as-markup.abide'
import List from './fixtures/template/21-a-list.abide'
import RowComponent from './fixtures/template/27-a-component-takes-props.abide'
import { Row as HandWrittenRow } from './fixtures/template/30-the-same-tag-hand-written.ts'
import { META } from './SUITES.ts'
import * as vanilla from './vanilla.ts'

install()

/** Which substrate is asking. Only the cases that COUNT their own evaluations need to know. */
type Lane = 'client' | 'server'

/** Render one template both ways, into a two-column card. Browser only — this is furniture. */
function both(host: HTMLElement, view: (lane: Lane) => TemplateResult): void {
    // Two `stage` frames rather than the dashed border spelled here: the frame is `.demo-host`, and a
    // second copy of it in Tailwind is the one card in these pages that would not move when it changes.
    const grid = el('div', 'grid gap-3 md:grid-cols-2')
    const pre = output(stage(grid, 'server'))
    const live = stage(grid, 'client')
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
                const host = scratch(view)
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
                const host = scratch(
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
                    high: 'rounded px-3 py-1 text-white bg-oxide disabled:opacity-40',
                    low: 'rounded px-3 py-1 text-white bg-pencil disabled:opacity-40',
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

                const host = scratch(view)
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
                const rows = scratch(
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
                        html`<button class="rounded bg-verdigris px-3 py-1" @click=${() => log.live('clicks', ++clicks)}>
                            click me
                        </button>`,
                )
            },
        },

        {
            title: 'ref slots — the NODE itself, client only',
            note: '`&ref=${x}` hands over the element. A state takes it through `set`; a function is a handler whose RETURN is its teardown — the contract `watch` already has, rather than a second lifecycle spelling. Like an event, the value IS the function: a slot kind that answered "is a function a thunk?" with an exception list per call site left this one calling the handler with no arguments.',
            async run({ is }) {
                const node = state<Element | null>(null)
                is(
                    'server emits nothing — there are no nodes there',
                    await renderToString(html`<p &ref=${node}>x</p>`),
                    '<p>x</p>',
                )

                const host = scratch(() => html`<p &ref=${node}>x</p>`)
                is('a state is handed the element', node()?.tagName, 'P')
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
                both(host, () => html`<p class="text-ink" &ref=${node}>the element this state holds</p>`)
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
                const text = state('typed by the state')
                is(
                    'server emits nothing for it',
                    await renderToString(html`<input .value=${'x'} />`),
                    '<input />',
                )

                const host = scratch(() => html`<input .value=${() => text()} />`)
                const node = host.querySelector('input') as HTMLInputElement
                is('client sets the PROPERTY', node.value, 'typed by the state')
                is('…and not the attribute', node.hasAttribute('value'), false)
                text.set('hello')
                await tick()
                is('and it updates', node.value, 'hello')
                host.remove()
            },
            interact({ host, log }) {
                const text = state('typed by the state')
                both(host, () => html`<input class="rounded bg-paper px-2 py-1" .value=${() => text()} />`)
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
                    return n.peek()!
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
                    return n.peek()!
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
                            n.set(n.peek()! + 1)
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
                const host = scratch(
                    () => html`<ul>${() => items().map((item) => html`<li>${item}</li>`)}</ul>`,
                )
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
                    html`<span class="rounded bg-paper px-2 py-0.5 text-xs">${text}</span>`
                both(
                    host,
                    () => html`<div class="flex gap-2">${() => items().map((item) => badge(item))}</div>`,
                )
                host.append(
                    row(
                        button('push', () => items.set([...items.peek()!, `item${items.peek()!.length}`])),
                        button('pop', () => items.set(items.peek()!.slice(0, -1))),
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

                const host = scratch(() => html`<div>${markup}</div>`)
                is('client parsed it as markup', host.querySelector('em')?.className, 'on-purpose')
                host.remove()
            },
            interact({ host }) {
                both(host, () => html`<div>${raw('<em class="text-brass">emphasis, on purpose</em>')}</div>`)
            },
        },

        {
            title: 'an async thunk defers a source read, and drops the promise it produced doing it',
            note: 'What `{await …}` costs the signal protocol, and the one line that pays it. A read SIGNALS by throwing, and the walk catches that synchronously and calls the thunk AGAIN once the load lands — but an `async` body converts the throw into a rejection, so nothing arrives to catch and `outstanding` is the only record left. The retry still produces correct markup, which is why this was invisible: what leaked was the DISCARDED promise, rejecting with the same signal and owned by nobody, as an unhandled rejection no author wrote. `retryableCall` claims it at the line that drops it. What no fix reaches is a read placed AFTER an await — nothing is tracked through one, which `settledPromise` already says of every async body in the framework, memos included.',
            async run({ is }) {
                const awaited = memo(async () => {
                    await sleep(5)
                    return 'A'
                })
                is(
                    'awaiting a source hands back a promise, and the slot renders it',
                    await renderToString(html`<p>${async () => await awaited}</p>`),
                    '<p>A</p>',
                )

                // The gate is that this case RUNS at all. Without the claim in `retryableCall` the
                // discarded promise rejects unowned, and `bun test` fails the whole file on the
                // unhandled rejection before any assertion here is reached — which is exactly how it
                // failed, and why the markup being right the whole time hid it.
                const read = memo(async () => {
                    await sleep(5)
                    return 'B'
                })
                is(
                    'a read inside one still defers, and leaves no rejection behind',
                    await renderToString(html`<p>${async () => read()}</p>`),
                    '<p>B</p>',
                )

                const plain = memo(async () => {
                    await sleep(5)
                    return 'C'
                })
                is(
                    'the plain thunk it has to agree with',
                    await renderToString(html`<p>${() => plain()}</p>`),
                    '<p>C</p>',
                )
            },
        },

        {
            title: 'a promise in an ATTRIBUTE, which is the same rule one position over',
            note: 'It used to stringify: `attributeText` is `String(value)`, so an attribute wrote the text `[object Promise]` where the same value in a child slot rendered what it resolved to. Two hole kinds meant different things for no reason either could state, and it is what made `{await …}` unemittable in an attribute — there was nothing for an async thunk to hand its promise to. The generation counter is the child slot’s: a load superseded before it settles is discarded, not painted over the newer value.',
            async run({ is }) {
                is(
                    'server awaits it in place',
                    await renderToString(html`<p title=${() => Promise.resolve('later')}>x</p>`),
                    '<p title="later">x</p>',
                )
                is(
                    'an async thunk is the same thing — what the compiler emits for `{await p}`',
                    await renderToString(html`<p title=${async () => await Promise.resolve('later')}>x</p>`),
                    '<p title="later">x</p>',
                )

                const host = scratch(() => html`<p title=${() => Promise.resolve('later')}>x</p>`)
                is('client — absent until it lands', host.querySelector('p')?.getAttribute('title'), null)
                await tick()
                is(
                    '…and then the value, not [object Promise]',
                    host.querySelector('p')?.getAttribute('title'),
                    'later',
                )
                host.remove()

                // The discard, which no assertion above can reach: without the counter the slow load
                // lands last and wins, and the attribute ends on a value already superseded.
                //
                // The promise is held OUTSIDE the state on purpose. `state(promise)` is a load — the
                // state absorbs it and the binder is handed the settled value, never the promise — so
                // a first attempt at this raced the mount instead of the write and passed with the
                // counter taken out. What the binder has to see is a promise, then a newer value.
                const slow = sleep(40).then(() => 'STALE')
                const which = state(0)
                const racing = scratch(() => html`<p title=${() => (which() === 0 ? slow : 'fresh')}>x</p>`)
                await sleep(5)
                which.set(1)
                await sleep(80)
                is(
                    'a superseded load does not paint over the newer value',
                    racing.querySelector('p')?.getAttribute('title'),
                    'fresh',
                )
                racing.remove()
            },
        },

        {
            title: 'a `{#try}` catches a throw from anywhere UNDER it, not just from running its body',
            note: "The body returns a `TemplateResult` whose slots are thunks, so a nested component's setup and a markup expression both run AFTER the body returned — past the guard that used to be the whole boundary. A `{#try}` around a layout's `<slot/>` therefore caught nothing at all, silently, which is the worst shape a guard can have. The region now owns a buffer and the walk runs inside it, so a failure anywhere under it discards what was written and emits the arm — the only thing catching can mean for markup, since an arm can only replace a region nobody has been given yet. The cost is that the region lands whole rather than chunking, which is already true of every slow region and is capped by `spill`. The last two assertions are the ones that say the catch was not bought by swallowing everything: a Pending signal still passes through, so a suspending region still suspends.",
            async run({ is }) {
                const arms = {
                    pending: undefined,
                    then: undefined,
                    catch: ((error: Error) => html`<b>caught: ${error.message}</b>`) as (
                        e: unknown,
                    ) => unknown,
                    finally: undefined,
                }
                const blows = (): string => {
                    throw new Error('deep')
                }

                // A THUNK in a slot — what every markup expression under a boundary compiles to, and
                // what a `<slot/>` in a layout hands over. It runs when the walk reaches it, which is
                // after the body returned.
                is(
                    'a throw from a slot thunk reaches `{:catch}`',
                    await renderToString(html`${boundary(() => html`<p>${() => blows()}</p>`, arms)}`),
                    '<b>caught: deep</b>',
                )

                // One level further down, through a nested template — the shape a component invocation
                // under a boundary produces.
                is(
                    'a throw nested two templates deep reaches it too',
                    await renderToString(
                        html`${boundary(() => html`<div>${html`<p>${() => blows()}</p>`}</div>`, arms)}`,
                    ),
                    '<b>caught: deep</b>',
                )

                // AND THE REGION IS REPLACED, not appended to: everything the body had already written
                // before the throw is discarded, or the arm would render after half a page.
                is(
                    'what the body wrote before the throw is discarded',
                    await renderToString(
                        html`${boundary(() => html`<p>before</p><p>${() => blows()}</p>`, arms)}`,
                    ),
                    '<b>caught: deep</b>',
                )

                // The boundary with nothing wrong under it is untouched — the arm is not reachable and
                // the body's own markup is what lands.
                is(
                    'a body that does not throw is unaffected',
                    await renderToString(html`${boundary(() => html`<p>${() => 'fine'}</p>`, arms)}`),
                    '<p>fine</p>',
                )
            },
        },

        {
            title: 'a `{#try}` catches what its body AWAITED, and still defers what its body READ',
            note: 'A `{#try}` catches what happens in it — an `await` is the operand most likely to fail, so it has to be among them. It did not: the body is emitted EAGERLY, one unit, so that a throw anywhere in it happens while the body runs and `{:catch}` is reachable at all, and an `await` there compiled to an invoked async IIFE whose REJECTION arrived long after the body returned. So the boundary caught nothing for the operand it most needed to. The fix keeps the body synchronous and has `settledBoundary` collect the promises the body left in its slots, deciding between the body and the catch arm once they settle; the walk is behind a compiler flag, so a `{#try}` with no await pays nothing and does not change shape. The third assertion is the one that says the catch was not bought with the DEFERRAL — a read signals by throwing, and the boundary must still let that signal through.',
            async run({ is }) {
                const arms = (catcher: (error: Error) => TemplateResult) => ({
                    pending: undefined,
                    then: undefined,
                    catch: catcher as (error: unknown) => unknown,
                    finally: undefined,
                })
                const caught = (error: Error): TemplateResult => html`<b>caught: ${error.message}</b>`

                // What `{#try}<p>{await p}</p>{:catch e}…{/try}` compiles to, flag included.
                is(
                    'a rejecting await reaches `{:catch}`',
                    await renderToString(
                        html`${boundary(
                            () => html`<p>${(async () => await Promise.reject(new Error('nope')))()}</p>`,
                            arms(caught),
                            true,
                        )}`,
                    ),
                    '<b>caught: nope</b>',
                )
                is(
                    '…and a resolving one renders the body',
                    await renderToString(
                        html`${boundary(
                            () => html`<p>${(async () => await Promise.resolve('V'))()}</p>`,
                            arms(caught),
                            true,
                        )}`,
                    ),
                    '<p>V</p>',
                )

                // The half the async-body route destroyed. A read SIGNALS by throwing, and the throw
                // is only a throw while the body is synchronous — this is the assertion that says the
                // boundary did not buy its catch with the deferral.
                const loaded = memo(async () => {
                    await sleep(5)
                    return 'LOADED'
                })
                is(
                    'a state read inside the block still defers',
                    await renderToString(
                        html`${boundary(() => html`<p>${loaded()}</p>`, arms(caught), false)}`,
                    ),
                    '<p>LOADED</p>',
                )

                // NESTED one block deep, which is the case that decides the whole design. The other
                // route — emitting the BODY `async` and the hole bare — is less machinery and passes
                // every assertion above, then emits `(() => c ? html`<p>${await p}</p>` : null)()`
                // for this one: a bare `await` inside the `{#if}`'s own non-async arrow, which is a
                // file no engine parses. Wrapping each awaiting hole is what keeps the `await` from
                // escaping into an enclosing thunk, and the walk below is what then finds it.
                // The emitted shape of `{#try}<div>{#if c}<p>{await p}</p>{/if}</div>{/try}`, with the
                // `{#if}`'s invoked thunk in the middle — so the promise is two templates down.
                const deep = (): TemplateResult =>
                    html`<div>${(() => html`<p>${(async () => await Promise.reject(new Error('deep')))()}</p>`)()}</div>`
                is(
                    'a rejection nested inside an `{#if}` still reaches `{:catch}`',
                    await renderToString(html`${boundary(deep, arms(caught), true)}`),
                    '<b>caught: deep</b>',
                )

                // Both at once, which is the case neither mechanism handles by accident.
                const also = memo(async () => {
                    await sleep(5)
                    return 'L'
                })
                is(
                    'a read and an await in the same block',
                    await renderToString(
                        html`${boundary(
                            () => html`<p>${also()}${(async () => await Promise.resolve('|A'))()}</p>`,
                            arms(caught),
                            true,
                        )}`,
                    ),
                    '<p>L|A</p>',
                )
            },
        },

        {
            title: 'a promise in a SPREAD, which is the same rule one hole kind further over',
            note: 'The failure mode an attribute’s fix left one position away, and a worse one than the `[object Promise]` it replaced: a spread reads `Object.keys` off what it is handed, and a promise has none — so `{...await props}` compiled clean, wrote NO attributes, and took back every name the previous pass had set. Nothing threw and nothing was logged. Making the emit async across positions is what reached this: until a spread’s thunk could be `async` the case was a build error, which is the loud failure this silence replaced. The generation stamp is the attribute binder’s, and it guards the same thing one step wider — a superseded spread must not take back names the newer one has already written.',
            async run({ is }) {
                is(
                    'server awaits it in place',
                    await renderToString(
                        html`<p ...=${() => Promise.resolve({ title: 'later', id: 'n' })}>y</p>`,
                    ),
                    '<p title="later" id="n">y</p>',
                )
                is(
                    'an async thunk is the same thing — what the compiler emits for `{...await p}`',
                    await renderToString(
                        html`<p ...=${async () => await Promise.resolve({ title: 'later' })}>y</p>`,
                    ),
                    '<p title="later">y</p>',
                )

                const host = scratch(() => html`<p ...=${() => Promise.resolve({ title: 'later' })}>y</p>`)
                is('client — absent until it lands', host.querySelector('p')?.getAttribute('title'), null)
                await tick()
                is('…and then every name it carries', host.querySelector('p')?.getAttribute('title'), 'later')
                host.remove()

                // The discard, and it is the half a spread owns that an attribute does not: the
                // binder TAKES BACK names the last pass wrote. Landing a superseded spread does not
                // merely paint a stale value, it removes what the newer one just set.
                const slow = sleep(40).then(() => ({ title: 'STALE' }))
                const which = state(0)
                const racing = scratch(
                    () => html`<p ...=${() => (which() === 0 ? slow : { title: 'fresh' })}>y</p>`,
                )
                await sleep(5)
                which.set(1)
                await sleep(80)
                is(
                    'a superseded spread neither paints nor takes back',
                    racing.querySelector('p')?.getAttribute('title'),
                    'fresh',
                )
                racing.remove()
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

                const host = scratch(() => html`<p>${Promise.resolve('later')}</p>`)
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
                                // Read the state SYNCHRONOUSLY, before handing back the promise.
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
            title: 'a thunk handing back a STATE is read one step further',
            note: "`${() => search({ q: filter() })}` needs no trailing `()`. States are recognised by a registry-symbol brand, not by being callable — so neither substrate imports the reactive graph to spot one, and a plain function passed to a `.prop` slot is still a plain function. EVERY slot kind reads that step, not just child slots: an attribute that read one step short rendered the state's own source text where the client rendered its value.",
            async run({ is }) {
                const held = state('a state, not a function')
                const host = scratch(() => html`<p>${() => held}</p>`)
                is(
                    'the handle in the slot means its VALUE',
                    host.querySelector('p')?.textContent,
                    'a state, not a function',
                )
                held.set('updated')
                await tick()
                is('and it stays subscribed', host.querySelector('p')?.textContent, 'updated')
                host.remove()

                // The same step, in the two slot kinds that are NOT a child — and asserted against
                // the server, because a lane that reads one step short is a hydration mismatch.
                const cls = state('big')
                const attrs = state<Record<string, unknown>>({ id: 'x', hidden: true })
                const attrHost = scratch(() => html`<div class=${() => cls}>a</div>`)
                is('attribute slot, client', attrHost.querySelector('div')?.getAttribute('class'), 'big')
                is(
                    'attribute slot, server',
                    await renderToString(html`<div class=${() => cls}>a</div>`),
                    '<div class="big">a</div>',
                )
                attrHost.remove()

                const spreadHost = scratch(() => html`<div ...=${() => attrs}>a</div>`)
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
                const held = state('a state, not a function')
                both(host, () => html`<p>${() => held}</p>`)
                host.append(
                    row(button('state.set(now)', () => held.set(`updated at ${Date.now() % 100000}`))),
                )
            },
        },

        {
            title: 'a spread NAME is runtime data, and the two lanes gate it the same way',
            note: 'A spread is the one attribute source whose NAME comes from a value rather than from the template, and the server writes that name into a string. A key carrying a space closes the attribute and opens whatever follows it, so `x onload=alert(1) y` is an event handler on the page. The client never could write it — `setAttribute` throws on the same name — so the lanes disagreed here, which is what made this a hydration bug as well as an injection and why the assertion below is owed on both.',
            async run({ is }) {
                const hostile = state<Record<string, unknown>>({ 'x onload=alert(1) y': '1', id: 'kept' })
                is(
                    'the server drops the name and keeps the rest',
                    await renderToString(html`<div ...=${() => hostile}>a</div>`),
                    '<div id="kept">a</div>',
                )
                const hostileHost = scratch(() => html`<div ...=${() => hostile}>a</div>`)
                is(
                    'and the client wrote the same thing',
                    hostileHost.querySelector('div')?.outerHTML,
                    '<div id="kept">a</div>',
                )
                hostileHost.remove()

                // The second half of the same walk: `for...in` reaches a prototype the caller never
                // wrote, so a polluted `Object.prototype` was an attribute on every spread element.
                const inherited = Object.create({ 'data-inherited': 'reached' }) as Record<string, unknown>
                inherited['data-own'] = 'written'
                is(
                    'an inherited key is not this element’s attribute',
                    await renderToString(html`<div ...=${() => inherited}>a</div>`),
                    '<div data-own="written">a</div>',
                )
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
                const host = scratch(() => html`<a ...=${() => props()}>go</a>`)
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
                const warm = scratch(() => listOf([rowOf(0)]))
                warm.remove()

                const built: TemplateResult[] = []
                for (let i = 0; i < 500; i++) built.push(rowOf(i))

                const identities = new Set(built.map((result) => result.strings))
                is('500 rows from one call site', built.length, 500)
                // The premise, not the claim: one `strings` object per call site is what the language
                // guarantees. What abide owes is caching the parse on that identity, and only the
                // counter below can say it did.
                is('distinct `strings` identities', identities.size, 1)

                // `mount` inside the measured window and `container()` outside it: the host's own
                // `createElement` would otherwise land in the count this case is about, which is why
                // this one place cannot be `scratch`. Held so the root still goes with the case.
                const host = container()
                let live: Mounted | undefined
                const work = await measureFlush(() => {
                    live = mount(host, () => listOf(built))
                })
                is('and they all rendered', host.querySelectorAll('li').length, 500)
                // The claim. An implementation that re-scanned and re-parsed per instantiation
                // renders the same 500 rows and scores 500 here.
                is('500 more instantiations parsed nothing', work.createElement, 0)
                live?.dispose()
            },
            bench: {
                kind: 'time',
                arms: (() => {
                    // The tag captures the strings and the values and renders nothing. This is the
                    // per-row allocation budget: one object, no scan — the scan is cached on the
                    // `strings` identity a tagged template gives for free.
                    const build = (n: number): unknown => html`<li class="row">${n}</li>`
                    // HOISTED, because the arm above gets it hoisted for free: a tagged template's
                    // strings are cached on the call site, so rebuilding the array per op put one
                    // allocation on the denominator that the numerator never pays — on the one card
                    // whose whole subject is the per-row allocation count.
                    const PLAIN_STRINGS = ['<li class="row">', '</li>']
                    const plain = (n: number): unknown => ({
                        strings: PLAIN_STRINGS,
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

        {
            title: 'the documented example runs',
            note: 'What `/docs/syntax` shows and mounts: every place a `${}` can sit, in one component. Asserted per POSITION rather than as one blob of markup, because what a slot means is decided by where it is — and a toggle that silently became a class string would still render something plausible.',
            async run({ is }) {
                // Rung 2 — content, and a whole attribute value.
                const attribute = scratch(() => Attribute({}))
                is('child position is content', attribute.querySelector('p')?.textContent, 'hello ada')
                const link = attribute.querySelector('a') as HTMLAnchorElement
                is('an attribute slot is the WHOLE value', link.getAttribute('href'), '/who/ada')
                is('…and one written bare is too', link.getAttribute('title'), 'ada')
                attribute.remove()

                // Rung 11 — a toggle, which is the claim a rendering cannot make on its own: what matters
                // is that the REST of the attribute is untouched.
                //
                // Driven by CLICKING it rather than by writing a state this file imported. The states are
                // the rung's own now — a `.abide` file may not bind one at module scope, since module
                // scope on a server is one instance for every visitor — so the button is the handle,
                // which is the one a reader has too.
                const toggled = scratch(() => Toggle({}))
                const styled = toggled.querySelector('p.line') as HTMLElement
                is('a toggle leaves the rest of the attribute alone', styled.className, 'line')
                toggled.querySelector('button')?.click()
                await tick()
                is('…and adds only its own class', styled.className, 'line danger')
                toggled.remove()

                // Rung 12 — a bind over a `{get, set}` pair. Both directions are asserted because the
                // failure this catches moved only ONE of them: the pair is hoisted into a name, the
                // emit read that name as a state and handed the OBJECT to the property slot, and the
                // input said `[object Object]` while every edit still went through `set` correctly.
                const pair = scratch(() => Accessors({}))
                const field = pair.querySelector('input') as HTMLInputElement
                is('the value is READ through get', field.value, 'ada')
                field.value = '  grace  '
                field.dispatchEvent(new Event('input'))
                await tick()
                is(
                    '…and the edit is written through set',
                    pair.querySelector('p')?.textContent,
                    'hello grace · 1 edits',
                )
                pair.remove()

                // Rung 19 — a list.
                const list = scratch(() => List({}))
                const rows: string[] = []
                for (const item of list.querySelectorAll('li')) rows.push(item.textContent ?? '')
                is('a {#for} over a state', rows, ['alpha', 'beta'])
                list.remove()

                // Rungs 25 and 28 — the same row, compiled and hand-written. Asserted as a PAIR and
                // compared to each other rather than to a literal, because the claim the two rungs
                // make together is that the compiled component and the `html` one are the same kind
                // of value. Two assertions against the same string would both pass with one of them
                // rendering nothing at all.
                // The prop arrives as a STATE — `Props<T>` maps each field to one — which is what lets a
                // parent re-point a child without re-running its setup.
                const which = state('gamma')
                const compiled = scratch(() => RowComponent({ row: which }))
                const written = scratch(() => HandWrittenRow({ row: which() }))
                is('a component takes a prop', compiled.querySelector('li')?.textContent, 'gamma')
                is(
                    '…and the hand-written tag renders the same node',
                    written.querySelector('li')?.outerHTML,
                    compiled.querySelector('li')?.outerHTML,
                )
                compiled.remove()
                written.remove()

                // Rung 15 — the escape, and the one spelling that skips it. Asserted as a PAIR from one
                // state, because either half alone passes for the wrong reason: `textContent` on the
                // escaped line is the same string whether the markup was escaped or parsed, and the
                // trusted line renders SOMETHING either way. What distinguishes them is whether a `<b>`
                // is an element or four characters, so the claim is about the node.
                const trusted = scratch(() => Trusted({}))
                const [escapedLine, trustedLine] = trusted.querySelectorAll('li')
                is('a slot ESCAPES — the markup arrived as text', escapedLine?.querySelector('b'), null)
                is('…so the tags are visible', escapedLine?.textContent, 'escaped: <b>ada</b> lovelace')
                is(
                    'html() does not — the markup arrived as a node',
                    trustedLine?.querySelector('b')?.textContent,
                    'ada',
                )
                is('…so the tags are gone from the text', trustedLine?.textContent, 'trusted: ada lovelace')
                trusted.remove()
            },
        },
    ],
})
