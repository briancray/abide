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

import { html, state, type State, type TemplateResult } from 'abide'
import { awaited, component, keyed } from 'abide/runtime'
import { renderToString } from 'abide/server'
import { container, suite } from 'abide-kit'
import { install, measure, measureFlush, nodesMade, nonZero, tick, total } from 'abide-kit/measure'
import { hydrate, mount } from 'abide/ui'
import { button, lazy, output, row, stage } from './dom.ts'
import { LADDER } from './fixtures/hydrate/ladder.ts'
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

/**
 * The same list with the row shape a `{#for}` actually COMPILES TO.
 *
 * `{#for row of rows}\n  <li>…</li>\n{/for}` emits a row template that opens and closes with static
 * whitespace, so the row above — whose markup starts at `<` and ends at `>` — is the one shape that
 * avoids the boundary split entirely. Keeping both is the point: the headline claim next door is
 * measured on the tight shape, and would read as a claim about `{#for}` if nothing said otherwise.
 */
const spacedListView = (rows: () => Item[]) => (): TemplateResult =>
    html`<ul class="font-mono text-xs">
        ${() =>
            rows().map((item) =>
                keyed(
                    item.id,
                    html`
        <li>${item.label}</li>
    `,
                ),
            )}
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
    examples: LADDER,
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
            title: 'an adopted slot lets go of the server’s marker when it stops owning the range',
            note: 'The opening marker is the server’s, and it brackets a range the part stops owning the moment it throws that range away — so it has to go with it. A repaint that reuses the same text node keeps both, which is why the claim is about the handover and not about the write. Left behind, the marker is invisible: the page reads correctly, every count is right, and the only trace is a comment accumulating in the document ahead of a range it no longer delimits. Every other case in this suite asserts markup or counts, and a stray comment changes neither — so this one asserts an ABSENCE, which is the only shape the claim has. The empty-range half is the half that discriminates: with nothing to remove, the release is not carried along by the removal loop beside it.',
            async run({ is }) {
                const shown = state<unknown>('first')
                const view = (): TemplateResult => html`<p>a${() => shown()}b</p>`
                const host = container()
                host.innerHTML = await renderToString(view(), { hydratable: true })
                is('the server wrote an opening marker', host.innerHTML.includes('<!--[-->'), true)

                hydrate(host, view)
                await tick()
                is('adoption leaves it alone', host.innerHTML.includes('<!--[-->'), true)

                // A write of the same KIND reuses the text node, so the range and its marker stand.
                shown.set('second')
                await tick()
                is('a repaint keeps both', host.querySelector('p')?.textContent, 'asecondb')
                is('…including the marker', host.innerHTML.includes('<!--[-->'), true)

                // A different kind cannot reuse anything: the range is torn down and rebuilt.
                shown.set(html`<i>third</i>`)
                await tick()
                is('the slot rebuilt', host.querySelector('p i')?.textContent, 'third')
                is('…and the marker went with the range', host.innerHTML.includes('<!--[-->'), false)
                host.remove()

                // The half that discriminates. A slot the server wrote NOTHING into still carries a
                // marker, and there is no removal loop for the release to ride along with — so this
                // is the shape that fails if the release is folded into the loop's own guard.
                const empty = state<unknown>('')
                const emptyView = (): TemplateResult => html`<p>a${() => empty()}b</p>`
                const bare = container()
                bare.innerHTML = await renderToString(emptyView(), { hydratable: true })
                is('an empty range still gets a marker', bare.innerHTML.includes('<!--[-->'), true)
                is('…and holds no nodes', bare.innerHTML.includes('<!--[--><!--$'), true)

                hydrate(bare, emptyView)
                await tick()
                empty.set('now something')
                await tick()
                is('the slot painted', bare.querySelector('p')?.textContent, 'anow somethingb')
                is(
                    '…and released a marker it had nothing to remove with',
                    bare.innerHTML.includes('<!--[-->'),
                    false,
                )
                bare.remove()
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
            title: 'an adopted row carries the server’s opening marker with it when it moves',
            note: '`claimChild` takes the server’s `<!--[-->` from IN FRONT of the nodes it claims, so an adopted range starts at that marker rather than at the first node the part is holding. A move that began one node late left the marker where it was: three reordered rows piled four of them at the head of the list and the rows arrived with none. The text reads correctly either way — which is why the count is the assertion. An unbalanced run of open markers is what a later depth scan walks into.',
            async run({ is }) {
                const rows = state([1, 2, 3])
                // A LEADING slot, because that is the only position whose content sits in front of
                // the part's own anchor and therefore decides where the row begins.
                const view = (): TemplateResult =>
                    html`<div>${() => rows().map((n) => keyed(n, html`${() => `p${n}`}<b>h${n}</b>`))}</div>`
                const host = container()
                host.innerHTML = await renderToString(view(), { hydratable: true })
                hydrate(host, view)
                await tick()
                const opened = (markup: string): number => (markup.match(/<!--\[-->/g) ?? []).length
                const before = opened(host.innerHTML)
                is('the server wrote a marker per adopted slot', before, 7)

                rows.set([3, 2, 1])
                await tick()
                is('the rows reversed', host.textContent, 'p3h3p2h2p1h1')
                is('and not one marker was left behind', opened(host.innerHTML), before)
                is('none of them piled up', host.innerHTML.includes('<!--[--><!--[--><!--[-->'), false)
                host.remove()
            },
        },

        {
            title: 'an ADOPTED list tears down by what its rows hold, not by what the server wrote',
            note: 'Every other teardown claim in this project is measured after a `mount`, and adoption is the case that breaks differently: `take` puts every server node of every row inside the part’s own range, so a teardown that detaches that range first leaves the rows loose — and a row walks its range by `nextSibling`, which is exactly what detaching it destroyed. Each row then stops after one node and the rest stay on screen, while the removal runs on past the range and takes the INCOMING content with it. Two shapes here because they fail in the two different directions: the first leaves nodes behind, the second removed too much and left the slot with no anchor at all.',
            async run({ is }) {
                // A row whose top-level slot REPLACES nodes after adoption — the only kind that can
                // put a row's live range out of step with the markup the server wrote for it.
                const shown = state(true)
                const swapped = state(false)
                const rowsView = (): TemplateResult =>
                    html`<div><span>kept</span>${() =>
                        shown()
                            ? [1, 2, 3].map((n) =>
                                  keyed(
                                      n,
                                      html`<b>h${n}</b>${() => (swapped() ? html`<i>x${n}</i>` : `p${n}`)}`,
                                  ),
                              )
                            : 'gone'}</div>`
                const host = container()
                host.innerHTML = await renderToString(rowsView(), { hydratable: true })
                hydrate(host, rowsView)
                await tick()
                is('adopted the server’s rows', host.textContent, 'kepth1p1h2p2h3p3')

                swapped.set(true)
                await tick()
                is('every row repainted', host.textContent, 'kepth1x1h2x2h3x3')

                shown.set(false)
                await tick()
                is('the whole list left, and nothing beside it did', host.textContent, 'keptgone')
                host.remove()

                // The same teardown with a row that GREW a nested list rather than repainting one —
                // no repaint at all, and still outside what the server wrote.
                const held = state(true)
                const sub = state([1])
                const grownView = (): TemplateResult =>
                    html`<div><span>kept</span>${() =>
                        held()
                            ? [1].map((n) =>
                                  keyed(n, html`<b>h${n}</b>${() => sub().map((s) => html`<u>s${s}</u>`)}`),
                              )
                            : 'gone'}</div>`
                const grown = container()
                grown.innerHTML = await renderToString(grownView(), { hydratable: true })
                hydrate(grown, grownView)
                await tick()
                sub.set([1, 2, 3])
                await tick()
                is('the sublist grew past the adopted range', grown.textContent, 'kepth1s1s2s3')

                held.set(false)
                await tick()
                is('and all of it left together', grown.textContent, 'keptgone')
                grown.remove()
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
            title: 'a row that opens and closes in whitespace costs 2n−1, and that is what {#for} emits',
            note: 'The case above adopts five rows for ONE mutation, which is the number this suite is known for — and it is measured on a row whose markup starts at `<` and ends at `>`. A `{#for}` does not emit that. `{#for row of rows}\\n  <li>…</li>\\n{/for}` compiles to a row template with static whitespace at both ends, and two adjacent rows then arrive from the server as ONE text node, because the parser has no reason to keep them apart. Splitting it at adopt time is what gives each row a disjoint range, without which a later move takes or leaves its neighbour’s whitespace. So the cost is real and so is the reason: 2n−1 mutations, kept here beside the 1 so neither number can be read as the other. What would make it 0 is deferring the split to the first move — a trade against the disjoint-range invariant, not a free win.',
            async run({ is, log }) {
                const rows = state(build(5))
                const view = spacedListView(() => rows())
                const host = await served(view)
                const before = Array.from(host.querySelectorAll('li'))
                is('the server wrote five rows', before.length, 5)

                const work = measure(() => void hydrate(host, view))
                // 2n−1: one insert per row, and a text write for every boundary but the last.
                is('inserts, one per row', work.insert, 5)
                is('text writes, one per boundary', work.textWrite, 4)
                is('total DOM work is 2n−1', total(work), 9)
                // Still no rebuild — the rows themselves are adopted, which is the claim that holds
                // for both shapes. What differs is the whitespace between them.
                is('nothing created', work.createElement, 0)
                is('every row is the SAME element', Array.from(host.querySelectorAll('li')), before)
                log('work to adopt five spaced rows', nonZero(work))
                host.remove()
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
            title: 'a deferring block keeps the arm the server painted',
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
            title: 'a COMPONENT is adopted, and the instance the adoption made is the live one',
            note: 'A component call is carried rather than made, so the walk that claims the server’s markup has to interpret the marker the same way the build path does — and adopting it IS the instance’s first pass, with the nodes already in place. Missing that arm, the marker fell through to the text arm and hydrated as `[object Object]`: a mismatch, a warning, and every component on the page rebuilt from scratch. The counters are the claim, because the screen is right either way; the write afterwards is the other half, since an adoption that kept no instance would have nothing for the next pass to write into.',
            async run({ is, log }) {
                const shout = state('ada')
                type Props = { who: State<string> }
                const Greeting = ({ who }: Props): TemplateResult => html`<b>hello ${() => who()}!</b>`
                const view = (): TemplateResult =>
                    html`<p>${() => component(Greeting, { who: shout() })}</p>`

                const host = await served(view)
                const bold = host.querySelector('b')
                is('the server rendered the component', host.textContent, 'hello ada!')

                const work = measure(() => void hydrate(host, view))
                is('nothing created', work.createElement, 0)
                is('nothing removed', work.remove, 0)
                is('one node inserted — the root anchor', work.insert, 1)
                is('the element is the one the parser made', host.querySelector('b'), bold)
                log('work to adopt a component', nonZero(work))

                // The instance is HELD by the position that adopted it, which is what makes the next
                // pass a write into a prop cell rather than a second call of the view.
                const wrote = await measureFlush(() => shout.set('grace'))
                is('a new prop costs one text write', wrote.textWrite, 1)
                is('…and nothing else', wrote.createElement + wrote.insert + wrote.remove, 0)
                is('the DOM', host.textContent, 'hello grace!')
                host.remove()
            },
        },

        {
            title: 'a divergence disposes what it half-adopted',
            note: 'The adopt walk has to BUILD before it can know the range matches — an instance per nested template, a row per list item, each holding one effect per reactive slot. When the check then fails, the part rebuilds; what it built first has to go with it. It did not: the handle was assigned only after the check, so a failed adoption left effects nothing held and nothing could dispose. Reached from a navigation there is no enclosing scope collecting them either, so they stayed subscribed for the life of the page, re-running on every write and writing into nodes already removed. Only counting the re-runs can see it — the screen is correct either way.',
            async run({ is }) {
                const beat = state(0)
                let reads = 0
                const view = (): TemplateResult =>
                    html`<div>${() =>
                        html`<p>${() => {
                            reads++
                            return beat()
                        }}</p>`}</div>`

                const host = await served(view)
                // What a divergent server would have written: one more node inside the slot's range
                // than this template accounts for. The nested instance adopts cleanly and only the
                // range check that follows it fails — which is exactly the window where the built
                // instance is live and unreferenced.
                const paragraph = host.querySelector('p') as Element
                paragraph.after(document.createElement('i'))

                hydrate(host, view)
                await tick()
                const afterAdopt = reads

                // Whatever survived is subscribed to this.
                beat.set(1)
                await tick()
                is('one live reader of the cell, not two', reads - afterAdopt, 1)
                is('and the rebuilt subtree is correct', host.querySelector('p')?.textContent, '1')
                host.remove()
            },
        },

        {
            title: 'a divergence costs that subtree, not the page',
            note: 'The adopt walk verifies as it goes — tag by tag, marker by marker — and a slot whose range is not what this template writes warns and builds itself instead. The unit that rebuilds is the template INSTANCE holding the divergent slot, so a stale cache or a non-deterministic render degrades to a rebuild of that component rather than a blank screen. The divergent half is a nested template here for that reason: in a page whose only template is the one that diverged, "that subtree" and "the page" are the same nodes and the case cannot tell a bounded rebuild from a total one — measured, that fixture clones five where this one clones two.',
            async run({ is, log }) {
                const inner = (): TemplateResult => html`<p>${'right'}</p>`
                const view = (): TemplateResult => html`<div><i>${'kept'}</i>${inner()}</div>`
                const host = await served(view)

                // What a divergent server would have written: the wrong tag inside the first slot.
                const wrong = host.querySelector('p') as Element
                wrong.replaceChildren(document.createElement('span'))
                // The half the note says is untouched, held by IDENTITY before the walk runs. A
                // client that bailed on the whole hydration and rebuilt the page reads identically
                // on both textContent assertions below — these are the only lines that can tell it
                // apart from one that rebuilt the divergent subtree alone.
                const untouched = host.querySelector('i') as Element
                const root = host.querySelector('div') as Element

                const work = measure(() => void hydrate(host, view))
                is('the divergent slot was rebuilt correctly', host.querySelector('p')?.textContent, 'right')
                is('and the rest of the page still reads right', host.querySelector('i')?.textContent, 'kept')
                // Both lines above pass just as well for a client that threw the whole page away and
                // rebuilt it — identical screen, identical text. These are the ones that separate it.
                is('the untouched half is the element the parser made', host.querySelector('i'), untouched)
                is('and so is the page around it', host.querySelector('div'), root)
                // Bounded to the inner INSTANCE: two clones, which is what `inner()` is made of. The
                // same divergence in a page whose only template is the one that diverged cloned five
                // — the whole thing — which is why the divergent half is nested here rather than
                // being a second slot in one template, where "that subtree" and "the page" are the
                // same nodes and no counter could tell the two implementations apart.
                is('only the inner template was cloned', work.cloneNode, 2)
                is('and nothing was created from scratch', work.createElement, 0)
                log('work to rebuild one divergent slot', nonZero(work))
                host.remove()
            },
        },
    ],
})
