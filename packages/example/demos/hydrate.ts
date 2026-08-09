// Hydration: the client ADOPTS what the server wrote instead of building its own.
//
// The claim is about WORK, not output — a client that throws the server's markup away and rebuilds
// produces exactly the same screen — so every case here counts DOM calls. The number to watch is
// one: the root anchor comment. Everything else on the page is the server's nodes, kept.
//
// Two things make it cheap, and neither is new. Every binding already compares before it writes, so
// a part handed markup that is already right runs its ordinary first update and writes nothing. And
// `classifySlots` is already the one classifier both substrates read, so the marker contract is
// declared once (`$shared/internal/MARKERS.ts`) rather than kept true by hand in two files.

import { awaited, html, state, type TemplateResult } from 'abide'
import { renderToString } from 'abide/server'
import {
    container,
    install,
    measure,
    measureFlush,
    nodesMade,
    nonZero,
    suite,
    tick,
    total,
} from 'abide/tests'
import { hydrate, keyed, mount } from 'abide/ui'
import { button, lazy, output, row, stage } from './dom.ts'
import { META } from './SUITES.ts'
import * as vanilla from './vanilla.ts'

install()

/**
 * Paint a view the way a server response would, then hand back the container.
 *
 * The warm-up mount is not ceremony: a call site is PARSED once, and that cost belongs to the
 * template cache, not to adoption. Measuring a cold call site would report the parse as hydration
 * work and hide the number this suite is about. `mount` pays it identically — see the `client` suite.
 */
async function served(view: () => TemplateResult): Promise<HTMLElement> {
    const warm = document.createElement('div')
    mount(warm, view).dispose()
    const host = container()
    host.innerHTML = await renderToString(view(), { hydratable: true })
    return host
}

// The same row type the vanilla arm builds, so the two are handed identical data rather than two
// shapes that agree by inspection.
type Item = vanilla.Row

const build = (n: number): Item[] => vanilla.rows(n)

const listView = (rows: () => Item[]) => (): TemplateResult =>
    html`<ul class="font-mono text-xs">
        ${() => rows().map((item) => keyed(item.id, html`<li>${item.label}</li>`))}
    </ul>`

// --- bench fixtures ---------------------------------------------------------
//
// Detached, and the markup is rendered ONCE at module scope: an arm that re-renders the string on
// every iteration is timing the server, not the adoption.

const ROWS_200 = build(200)
const rowsCell = state(ROWS_200)
const BENCH_VIEW = listView(() => rowsCell())

// The markup both arms start from. Rendering it is the SERVER's half of this suite and touches no
// document, so it stays where it is: at module scope, once.
const SERVED_MARKUP = await renderToString(BENCH_VIEW(), { hydratable: true })
const VANILLA_MARKUP = vanilla.rowsToString(ROWS_200)

/**
 * Where the arms' hosts hang, made on FIRST USE rather than at import.
 *
 * Lazy for the reason `lazy` exists — a suite module is imported on the server too. The warm-up rides
 * along because a call site is PARSED once, and the first arm must not be the one that pays for it.
 * Every arm reaches its host through `benchHost`, so warming here is still warming before anything is
 * measured.
 */
const detached = lazy((): HTMLElement => {
    const warm = document.createElement('div')
    mount(warm, BENCH_VIEW).dispose()
    return document.createElement('div')
})

function benchHost(markup: string): HTMLElement {
    const host = document.createElement('div')
    host.innerHTML = markup
    detached().append(host)
    return host
}

export default suite({
    ...META.hydrate,
    cases: [
        {
            title: 'adopting server markup writes NOTHING',
            note: 'The counters are the whole claim: a client that rebuilt would produce an identical screen at full cost. Nothing is created, nothing is removed, no text is written, no attribute is set — and the elements on the page after hydration are the same objects the parser made.',
            async run({ is, log }) {
                const name = state('ada')
                const level = state('high')
                const view = (): TemplateResult => html`<p class=${() => level()}>hello ${() => name()}!</p>`

                const host = await served(view)
                const paragraph = host.querySelector('p')

                const work = measure(() => void hydrate(host, view))
                is('nothing created', work.createElement, 0)
                is('nothing removed', work.remove, 0)
                is('no text written', work.textWrite, 0)
                is('no attribute written', work.setAttribute, 0)
                is('one node inserted — the root anchor', work.insert, 1)
                is('total DOM work', total(work), 1)
                // The anchor comment is the ONE node an adoption makes; a build makes an element and
                // a text node per row on top of it.
                is('nodes made', nodesMade(work), 1)
                is('the element is the one the parser made', host.querySelector('p'), paragraph)
                is('and it reads right', host.querySelector('p')?.textContent, 'hello ada!')

                // Adopted, not merely left alone: the bindings are LIVE.
                const wrote = await measureFlush(() => name.set('grace'))
                is('a write costs one text write', wrote.textWrite, 1)
                is('…and nothing else', wrote.createElement + wrote.insert + wrote.remove, 0)
                is('the DOM', host.querySelector('p')?.textContent, 'hello grace!')
                log('work to adopt', nonZero(work))
                host.remove()
            },
            interact({ host, log }) {
                const name = state('ada')
                const out = stage(host)
                const view = (): TemplateResult => html`<p class="text-slate-100">hello ${() => name()}!</p>`
                const pane = output(host)
                let adopted = false
                host.append(
                    row(
                        button('render on the “server”, then adopt', async () => {
                            out.innerHTML = await renderToString(view(), { hydratable: true })
                            pane.textContent = out.innerHTML
                            const work = measure(() => void hydrate(out, view))
                            adopted = true
                            log.live('work to adopt', nonZero(work))
                        }),
                        // Before the adopt there is nothing for a write to be live AGAINST, and a
                        // report of no work over an empty frame reads like the claim failing.
                        button('name.set(random) — is it live?', async () => {
                            if (!adopted) {
                                log.live('work for one write', 'adopt first — nothing is mounted yet')
                                return
                            }
                            const work = await measureFlush(() =>
                                name.set(Math.random().toString(36).slice(2, 6)),
                            )
                            log.live('work for one write', nonZero(work))
                        }),
                    ),
                )
                log('', 'the markers are the two comments in the markup above — one pair per child slot')
            },
        },

        {
            title: 'the markers are opt-in, and only child slots carry them',
            note: 'A render nobody is going to hydrate should not read differently or pay for it, so `{ hydratable: true }` is asked for. An element holding an attribute slot needs no marker of its own: the prepared template and the live document agree on it POSITIONALLY, so the adopt walk finds it by shape. A child slot is the opposite — its content is a value the template does not contain, and the HTML parser would merge `<p>a${x}b</p>` into one text node.',
            async run({ is }) {
                const view = (): TemplateResult => html`<p class=${'card'}>a${'X'}b</p>`
                is('plain — unchanged', await renderToString(view()), '<p class="card">aXb</p>')
                is(
                    'hydratable — two comments around the child slot, none around the attribute',
                    await renderToString(view(), { hydratable: true }),
                    '<p class="card">a<!--[-->X<!--$1-->b</p>',
                )
                // The pair is what stops the parser handing back one text node instead of three.
                const host = container()
                host.innerHTML = await renderToString(view(), { hydratable: true })
                is('three text nodes, not one', host.querySelector('p')?.childNodes.length, 5)
                host.remove()
            },
        },

        {
            title: 'every template SHAPE builds and adopts to the same markup',
            note: 'A template that is ONE element clones that element; anything else clones the fragment around it, because a single root that is a comment IS its own anchor and a part inserting before an anchor with no parent has nowhere to put what it renders. Two paths through the builder, and a table rather than one example, because the shape that breaks is never the one anybody writes a case for.',
            async run({ is }) {
                const shapes: [string, () => TemplateResult, string][] = [
                    ['one element', () => html`<p>a</p>`, '<p>a</p>'],
                    ['one element, child slot', () => html`<p>x ${'y'} z</p>`, '<p>x y z</p>'],
                    [
                        'one element, attribute slot',
                        () => html`<a href=${'/x'}>go</a>`,
                        '<a href="/x">go</a>',
                    ],
                    ['sibling slots under one root', () => html`<p>${'a'}${'b'}${'c'}</p>`, '<p>abc</p>'],
                    [
                        'nested, slots at two depths',
                        () => html`<div class=${'c'}><span>${'s'}</span><b>${'t'}</b></div>`,
                        '<div class="c"><span>s</span><b>t</b></div>',
                    ],
                    ['two roots', () => html`<p>a</p><p>${'b'}</p>`, '<p>a</p><p>b</p>'],
                    ['a bare text slot at the root', () => html`${'hello'}`, 'hello'],
                    ['text before the element', () => html`lead <p>${'x'}</p>`, 'lead <p>x</p>'],
                ]
                const strip = (markup: string): string => markup.replace(/<!--[^>]*-->/g, '')

                for (const [name, view, expected] of shapes) {
                    const built = container()
                    mount(built, view)
                    await tick()
                    is(`${name} — built`, strip(built.innerHTML), expected)
                    built.remove()

                    const adopted = container()
                    adopted.innerHTML = await renderToString(view(), { hydratable: true })
                    hydrate(adopted, view)
                    await tick()
                    is(`${name} — adopted`, strip(adopted.innerHTML), expected)
                    adopted.remove()
                }
            },
        },

        {
            title: 'a keyed list is adopted row by row, with no per-row marker',
            note: 'A row IS a template, and adopting a template consumes exactly the nodes it describes — so each row delimits itself and hands the cursor to the next. The rows survive as the same elements, which is what makes the next reorder a MOVE rather than a rebuild.',
            async run({ is, log }) {
                const rows = state(build(5))
                const view = listView(() => rows())
                const host = await served(view)
                const before = Array.from(host.querySelectorAll('li'))
                is('the server wrote five rows', before.length, 5)

                const work = measure(() => void hydrate(host, view))
                is('nothing created', work.createElement, 0)
                is('nothing removed', work.remove, 0)
                is('total DOM work', total(work), 1)
                // Five rows adopted, and still only the root anchor is made — which is the whole
                // difference from a build, and the number that would grow if a row ever rebuilt.
                is('nodes made', nodesMade(work), 1)
                is('every row is the SAME element', Array.from(host.querySelectorAll('li')), before)

                // And the keys survived the adoption, so a swap moves.
                const next = rows.peek().slice()
                const held = next[1] as Item
                next[1] = next[2] as Item
                next[2] = held
                const swap = await measureFlush(() => rows.set(next))
                is('an adjacent swap moves one row', swap.insert, 1)
                is('…and creates nothing', swap.createElement, 0)
                is(
                    'the order',
                    Array.from(host.querySelectorAll('li')).map((li) => li.textContent),
                    ['row 0', 'row 2', 'row 1', 'row 3', 'row 4'],
                )
                log('work to adopt five rows', nonZero(work))
                host.remove()
            },
            interact({ host, log }) {
                const rows = state(build(200))
                const view = listView(() => rows())
                const out = stage(host, 'live (scroll)')
                out.className += ' max-h-40 overflow-auto'
                host.append(
                    row(
                        button('server render + adopt 200 rows', async () => {
                            out.innerHTML = await renderToString(view(), { hydratable: true })
                            const work = measure(() => void hydrate(out, view))
                            log.live('adopt 200 rows', nonZero(work))
                        }),
                        button('…now swap two of them', async () => {
                            const next = rows.peek().slice()
                            const held = next[1] as Item
                            next[1] = next[198] as Item
                            next[198] = held
                            const work = await measureFlush(() => rows.set(next))
                            log.live('swap after adopting', nonZero(work))
                        }),
                    ),
                )
                log('', 'the rows moved — which is only possible because adoption kept them')
            },
            bench: {
                kind: 'work',
                arms: [
                    {
                        label: 'abide — hydrate over the server’s 200 rows',
                        prepare: () => void benchHost(SERVED_MARKUP),
                        run: () => void hydrate(benchHost(SERVED_MARKUP), BENCH_VIEW),
                    },
                    {
                        label: 'abide — mount, throwing the server’s rows away',
                        run: () => void mount(benchHost(SERVED_MARKUP), BENCH_VIEW),
                    },
                    {
                        label: 'vanilla — walk the rows and keep their text nodes',
                        run: () =>
                            void vanilla.adoptRows(benchHost(VANILLA_MARKUP).firstElementChild as Element),
                    },
                ],
            },
        },

        {
            title: 'hydrating 200 rows against building them',
            note: 'The ratio, not the milliseconds. Adoption walks the markup the parser already built; a mount builds a second copy of it and then discards the first. The vanilla arm is the floor: it walks the same nodes and keeps references, without having to recover from the markup what the author already knew.',
            bench: {
                kind: 'time',
                per: { n: 200, label: 'row' },
                arms: [
                    {
                        label: 'abide — hydrate',
                        run: () => void hydrate(benchHost(SERVED_MARKUP), BENCH_VIEW),
                    },
                    {
                        label: 'abide — mount (build it again)',
                        run: () => void mount(benchHost(SERVED_MARKUP), BENCH_VIEW),
                    },
                    {
                        label: 'vanilla — walk and keep',
                        run: () =>
                            void vanilla.adoptRows(benchHost(VANILLA_MARKUP).firstElementChild as Element),
                    },
                ],
            },
        },

        {
            title: '`{#await}` keeps the arm the server painted',
            note: 'The server AWAITS its operand and paints the settled arm; this side starts with a promise in flight. Painting `pending` over correct markup would be a flash back to a state the reader never saw, so the range is held as it is and the settle replaces it. It is a rebuild when it lands — the client cannot know which arm those nodes are until then — and that is the honest cost of a value the two sides do not share.',
            async run({ is }) {
                const arms = { pending: () => 'loading…', then: (v: string) => html`<b>${v}</b>` }
                const host = container()
                host.innerHTML = await renderToString(
                    html`<p>${() => awaited('from the server', arms)}</p>`,
                    { hydratable: true },
                )
                is('the server painted the settled arm', host.textContent, 'from the server')

                let land!: (value: string) => void
                const view = (): TemplateResult =>
                    html`<p>${() => awaited(new Promise<string>((resolve) => (land = resolve)), arms)}</p>`
                hydrate(host, view)
                is('adopted — NOT thrown back to pending', host.textContent, 'from the server')

                land('from the client')
                await tick()
                is('and the settle replaces it', host.textContent, 'from the client')
                host.remove()
            },
        },

        {
            title: 'a divergence costs that subtree, not the page',
            note: 'The adopt walk verifies as it goes — tag by tag, marker by marker — and a slot whose range is not what this template writes warns and builds itself instead. Nothing else on the page is touched, so a stale cache or a non-deterministic render degrades to a rebuild rather than a blank screen.',
            async run({ is }) {
                const view = (): TemplateResult => html`<div><p>${'right'}</p><i>${'kept'}</i></div>`
                const host = await served(view)

                // What a divergent server would have written: the wrong tag inside the first slot.
                const wrong = host.querySelector('p') as Element
                wrong.replaceChildren(document.createElement('span'))

                hydrate(host, view)
                is('the divergent slot was rebuilt correctly', host.querySelector('p')?.textContent, 'right')
                is('and the rest of the page still reads right', host.querySelector('i')?.textContent, 'kept')
                host.remove()
            },
        },
    ],
})
