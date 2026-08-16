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

import { html, memo, state, type State, type TemplateResult } from 'abide'
import { awaited, boundary, component, keyed } from 'abide/runtime'
import { renderDocument, renderToString } from 'abide/server/internal'
import { shell } from 'abide/server/internal'
import { type Case, container, scratch, sleep, suite } from 'harness'
import { install, keep, measure, measureFlush, nodesMade, nonZero, tick, total } from 'harness/measure'
import { hydrate, mount, type Mounted } from 'abide/ui'
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

/** A shell with a hole in it, which is what makes the hydration root an element rather than the body. */
const SHELL = shell('<!doctype html><html><head></head><body><slot></slot></body></html>')

/**
 * The same, but through the DOCUMENT lane — the whole of what a browser is handed, patches included.
 *
 * `served` above renders a fragment, which is the right substrate for every other case here and the
 * wrong one for this claim: a deferred region is not markup the walk wrote. It is a placeholder, a
 * `<template>` and a `<script>` that arrive after the walk is done and swap themselves in, so what is
 * left INSIDE the hydration root is decided by the document lane and nowhere else.
 *
 * The swap is spelled out rather than run: a `<script>` set through `innerHTML` never executes, in a
 * browser or here. These are `PATCH_SWAP`'s two lines, and the script element is left behind exactly
 * as a browser leaves it — which is the node the claim is about.
 */
async function servedDocument(view: () => TemplateResult): Promise<HTMLElement> {
    const warm = document.createElement('div')
    mount(warm, view).dispose()

    let text = ''
    for await (const chunk of renderDocument(SHELL, view, { hydratable: true })) text += chunk

    const host = container()
    host.innerHTML = text.slice(text.indexOf('<body>') + '<body>'.length, text.lastIndexOf('</body>'))
    for (const script of Array.from(host.querySelectorAll('script'))) {
        const call = /^\$p\((\d+)\)$/.exec(script.textContent ?? '')
        if (call === null) continue
        const patch = host.querySelector(`#t${call[1]}`) as HTMLTemplateElement | null
        const placeholder = host.querySelector(`#s${call[1]}`)
        if (patch !== null && placeholder !== null) {
            placeholder.replaceWith(patch.content)
            patch.remove()
        }
    }
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

/** One SIZE of the same list, with everything three arms need to start from the same bytes. */
interface Sized {
    n: number
    rows: Item[]
    view: () => TemplateResult
    /** What the server wrote, rendered once. An arm that re-renders it is timing the server. */
    served: string
    /** The same document by hand, so the vanilla arm parses the same bytes rather than similar ones. */
    byHand: string
}

async function sized(n: number): Promise<Sized> {
    const rows = build(n)
    // Through a cell rather than the array, so the list slot has the same reactive shape a real page
    // gives it — an arm reading a constant subscribes to nothing and skips work every size pays.
    const cell = state(rows)
    const view = listView(() => cell())
    return {
        n,
        rows,
        view,
        served: await renderToString(view(), { hydratable: true }),
        byHand: vanilla.rowsToString(rows),
    }
}

// Three sizes, because ONE size cannot tell a per-row cost from a fixed one — both look like a
// constant. 10000 is the one that matters: the round trip costs about 1.3 µs a row and holds that
// across all three, so a frame arrives at roughly twelve thousand rows and nothing below it is
// perceptible however the ratio reads.
const SMALL = await sized(100)
const MEDIUM = await sized(1000)
const LARGE = await sized(10000)

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
    mount(warm, SMALL.view).dispose()
    return document.createElement('div')
})

/**
 * The one live mount an arm is allowed to leave behind, so a run does not retain every iteration.
 *
 * Dropping the host is not enough and that is the whole of this: a mount's list slot is SUBSCRIBED to
 * the cell it reads, so the effect outlives the nodes and holds the entire part tree with it. Twenty
 * undisposed mounts wake twenty readers on one write — measured, and the number this suite would
 * report is right either way. At 10000 rows over a calibrated run it is more than a million nodes the
 * collector cannot touch, which is enough for Safari to reload the tab out from under the run. That
 * is how it was found, and no assertion in the repo could have: the arms all reported correctly right
 * up until the page died.
 */
let held: Mounted | null = null

function hold(mounted: Mounted): void {
    held = mounted
}

// `replaceChildren` rather than `append`, and that is a measurement decision rather than tidiness: an
// arm makes a host per iteration, so appending retains every one of them for the length of the run.
// The dispose beside it is the same act for the part graph — an iteration takes down the one before
// it, which is symmetric across every arm and bounds the heap to two trees whatever the size.
function benchHost(markup: string): HTMLElement {
    held?.dispose()
    held = null
    const host = document.createElement('div')
    host.innerHTML = markup
    detached().replaceChildren(host)
    return host
}

/**
 * The round trip at ONE size — six arms, three times, differing by a number.
 *
 * A function rather than three written out, because what the three sizes are for is the DIFFERENCE
 * between them: an arm list that drifted between sizes would make a per-row cost and a fixed cost
 * indistinguishable, which is the whole reason there is more than one card.
 */
function roundTrip(size: Sized, note: string): Case {
    return {
        title: `the whole round trip at ${size.n} rows: render, parse, adopt`,
        note,
        bench: {
            kind: 'time',
            per: { n: size.n, label: 'row' },
            arms: [
                {
                    label: 'abide — the whole trip: render + parse + adopt',
                    run: async () => {
                        const markup = await renderToString(size.view(), { hydratable: true })
                        hold(hydrate(benchHost(markup), size.view))
                    },
                },
                {
                    label: '…of which the server: renderToString({ hydratable: true })',
                    run: async () => keep(await renderToString(size.view(), { hydratable: true })),
                },
                {
                    label: '…of which the parse: innerHTML, no adoption',
                    run: () => keep(benchHost(size.served)),
                },
                {
                    label: '…of which the client: parse + adopt',
                    run: () => hold(hydrate(benchHost(size.served), size.view)),
                },
                {
                    label: 'abide — no server at all: build into an empty host',
                    run: () => hold(mount(benchHost(''), size.view)),
                },
                {
                    label: 'vanilla — concat + parse + walk and keep',
                    run: () => {
                        const host = benchHost(vanilla.rowsToString(size.rows))
                        keep(vanilla.adoptRows(host.firstElementChild as Element))
                    },
                },
            ],
        },
    }
}

const ROUND_TRIP_NOTE =
    'Every other bench in this suite starts from markup rendered once at module scope, which is the right substrate for pricing adoption ALONE and hides what a served page costs end to end. This one is the sum, with the share named under it, because an optimisation is capped by the fraction of the op it touches: the first arm is the whole thing, the second is the server’s half, the fourth is the client’s — and those two are what the first adds up to. The third is INSIDE the fourth rather than beside it: the parser is a large part of what the client pays, and no arrangement of the server avoids it, so a change to the adopt walk is working on the remainder rather than on the number above it. The fifth arm is the one that stops the card being read as a win — building on the client with no server render at all is LESS total work than rendering it, parsing it and adopting it. What the round trip buys is a page that is readable before any of that runs, and the ratio to weigh it against is the last arm: the same trip by hand. This size is well under a frame, so read the two cards below it before quoting any of these ratios as something a person would feel.'

const MEDIUM_NOTE =
    'The same six arms, five times the rows, and the two cards are meant to be read TOGETHER — one size cannot tell a per-row cost from a fixed one, because both look like a constant. The per-row column is where the answer is, and here it is FLAT: every arm holds its per-row number across the two sizes, so there is no fixed cost the smaller list was failing to amortise and no crossover to find. That is worth having measured rather than assumed — the client suite’s cold build does NOT hold flat over the same jump — and it is what makes the shares on the card above survive a change of n.'

const LARGE_NOTE =
    'A hundred times the first card, and the size that changes what the number MEANS rather than what it is: the per-row cost is the same as at 100, so what this card adds is WHERE it starts to matter. Click to paint is frame quantised, so every implementation under one frame reads alike and a ratio at 100 rows is a fact about a cost nobody perceives — at this per-row cost the whole trip crosses a frame at about twelve thousand rows, which is the n to design against and the only place a change to the adopt walk moves something a reader would notice. Run it in a FRESH page — an op that makes tens of thousands of nodes leaves enough garbage that whatever runs next measures this instead of itself — and run it twice, because one run cannot tell a real difference from a collection that landed inside a batch.'

export default suite({
    ...META.hydrate,
    cases: [
        {
            title: 'a `{#try}` whose body AWAITS still adopts — only the awaiting hole is replaced',
            note: 'The adoption win survives the block that can defer. A boundary body runs SYNCHRONOUSLY even when a hole in it awaits, so the structure is knowable the moment the body returns and only the hole is not — but `settledBoundary` folds the two into one promise, and a part handed an opaque promise claims the range and replaces every node in it on settle. That threw away the whole subtree the server sent for the sake of one text node. `producedBoundary` is the same body run without the fold: the structure adopts, and each awaiting hole claims its own nodes one level down. The element identity below is the assertion — same node before and after, which no output comparison can make, since a rebuild renders the identical screen.',
            async run({ is }) {
                const arms = {
                    pending: undefined,
                    then: undefined,
                    catch: (() => html`<b>caught</b>`) as (error: unknown) => unknown,
                    finally: undefined,
                }
                // What `{#try}<p id="keep">{await p}</p>{/try}` compiles to: eager body, IIFE hole.
                const view = (): TemplateResult =>
                    html`${boundary(
                        () =>
                            html`<p id="keep">
                                ${(async () => {
                                    await sleep(1)
                                    return 'V'
                                })()}
                            </p>`,
                        arms,
                        true,
                    )}`

                const host = container()
                host.innerHTML = await renderToString(view(), { hydratable: true })
                const before = host.querySelector('#keep')
                is('the server sent the element', before !== null, true)

                hydrate(host, view)
                await sleep(20)

                is('the SAME element is still there', host.querySelector('#keep') === before, true)
                is('…and the awaiting hole landed', host.querySelector('#keep')?.textContent?.trim(), 'V')
                host.remove()
            },
        },

        {
            title: 'a `{:finally}` arm is part of what the body PRODUCED, so its nodes adopt too',
            note: 'The server writes the body and the `{:finally}` arm into ONE range, because `settledArms` returns both and the renderer walks the pair. `take` claimed only the body: `finally` was applied a layer up in `settledBoundary`, which the adopt path deliberately does not go through, so the arm’s nodes were left over inside the claimed range — a mismatch, and a rebuild of a region the server got exactly right. Every `{#try}` with the arm paid it, and NOTHING about the output could show it: the rebuild paints the same screen. What says so is the count below, which is 0 removals and 0 creations against 5 and 4 with the fix out.',
            async run({ is, log }) {
                const arms = {
                    pending: undefined,
                    then: undefined,
                    catch: (() => html`<b>caught</b>`) as (error: unknown) => unknown,
                    // The arm under test. Shown either way, which is what puts its nodes in the
                    // server's range beside the body's.
                    finally: () => html`<small>asked either way</small>`,
                }
                const view = (): TemplateResult =>
                    html`${boundary(() => html`<p id="body">the row is alpha</p>`, arms, false)}`

                // A call site is PARSED once, and parsing builds the elements a template is cloned
                // from — three of them here, which would otherwise read as three the adoption built.
                // That cost belongs to the template cache, so it is paid before the measurement, the
                // way `proofsOf` pays it.
                const warm = container()
                mount(warm, view).dispose()
                warm.remove()

                const host = container()
                host.innerHTML = await renderToString(view(), { hydratable: true })
                is('the server wrote both arms', host.querySelector('small')?.textContent, 'asked either way')
                const before = host.querySelector('#body')

                const work = measure(() => void hydrate(host, view))
                log('work to adopt', nonZero(work))
                // The four that mean REBUILT, and the element identity beside them: a rebuild replaces
                // the node with an identical one, so the count and the identity are the same claim
                // asked twice — and neither is visible in the markup.
                is('nothing removed', work.remove, 0)
                is('nothing built', work.createElement, 0)
                is('the SAME body element is still there', host.querySelector('#body') === before, true)
                is('…and the arm is still beside it', host.querySelector('small')?.textContent, 'asked either way')
                host.remove()
            },
        },

        {
            title: 'a frame is its own realm — counting inside one needs its own install',
            note: 'A document of its own is what an isolated demo needs: its own shell, its own stylesheet, its own hydration, none of it entangled with the page around it. What it costs is this — the counters patch PROTOTYPES, and chromium gives a frame a fresh set, so a frame’s work is invisible to a page’s install and every claim about it reads zero while passing. Under happy-dom the frame is handed the SAME prototypes, so this case passes here whether or not the install below happened — which is exactly why the number that matters is the browser’s, on `/tests/hydrate`. Keyed by prototype rather than by document so the emulator does not patch its one set twice and bill everything twice.',
            async run({ is, log }) {
                const host = container()
                const frame = document.createElement('iframe')
                host.append(frame)
                // A frame's document is not there on the same tick it is appended.
                for (let waited = 0; frame.contentDocument?.body == null && waited < 50; waited++) await sleep(10)
                const inner = frame.contentDocument
                if (inner?.body == null) {
                    log('no frame document', 'this lane has no frames — nothing to count')
                    host.remove()
                    return
                }

                install(inner)
                const work = measure(() => {
                    const paragraph = inner.createElement('p')
                    inner.body.append(paragraph)
                })

                // Two calls, in a document this case does not live in. Zero here in a browser is the
                // failure this exists to catch: it reads as "the frame did no work".
                is('the element the frame made', work.createElement, 1)
                is('and the insertion', work.insert, 1)
                log('work inside the frame', nonZero(work))

                // The page's own realm is still counted, and not twice.
                const outer = measure(() => host.append(document.createElement('p')))
                is('the page is still counted', outer.createElement, 1)
                is('…once', outer.insert, 1)
                host.remove()
            },
        },
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
                const view = (): TemplateResult => html`<p class="text-ink">hello ${() => name()}!</p>`
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
                    const built = scratch(view)
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
            title: 'every ROW KIND an array can hold renders the same on both substrates',
            note: 'The server walks an array with its general emit, so every one of these renders there. The client sends an array to the keyed reconcile, which reads `.strings` off every row — so a row that was not a template threw, and `${() => [\'a\', \'b\']}` was source that renders on the server and crashes in the browser. That is a divergence rather than a missing feature, which is why the expectation here is the SERVER’S OWN OUTPUT rather than a string written by hand: an expectation written twice can be got wrong in the same direction twice. A row that cannot be reconciled is wrapped into one that can, at one call site, so it patches its text on a later pass instead of rebuilding. Adoption of a non-template row falls back to building — the server writes no per-row marker for one — which is the documented recovery and asserted here as such.',
            async run({ is }) {
                const kinds: [string, () => TemplateResult][] = [
                    ['templates', () => html`<ul>${() => [html`<li>x</li>`, html`<li>y</li>`]}</ul>`],
                    ['strings', () => html`<ul>${() => ['a', 'b']}</ul>`],
                    ['numbers', () => html`<ul>${() => [1, 2]}</ul>`],
                    ['a template and a string', () => html`<ul>${() => [html`<li>x</li>`, 'y']}</ul>`],
                    ['a null hole', () => html`<ul>${() => [html`<li>x</li>`, null]}</ul>`],
                    ['undefined', () => html`<ul>${() => ['a', undefined]}</ul>`],
                    ['a nested array', () => html`<ul>${() => [[html`<li>x</li>`]]}</ul>`],
                    [
                        'a component',
                        () =>
                            html`<ul>${() => [
                                component(
                                    (props: { label: unknown }) =>
                                        html`<b>${() => (props.label as () => unknown)()}</b>`,
                                    { label: 'x' },
                                ),
                                'plain',
                            ]}</ul>`,
                    ],
                ]
                const strip = (markup: string): string => markup.replace(/<!--[^>]*-->/g, '')

                for (const [name, view] of kinds) {
                    const expected = strip(await renderToString(view()))

                    const built = scratch(view)
                    await tick()
                    is(`${name} — built matches the server`, strip(built.innerHTML), expected)
                    built.remove()

                    const adopted = container()
                    adopted.innerHTML = await renderToString(view(), { hydratable: true })
                    hydrate(adopted, view)
                    await tick()
                    is(`${name} — adopted matches the server`, strip(adopted.innerHTML), expected)
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
                        label: 'abide — hydrate over the server’s 100 rows',
                        prepare: () => void benchHost(SMALL.served),
                        run: () => hold(hydrate(benchHost(SMALL.served), SMALL.view)),
                    },
                    {
                        label: 'abide — mount, throwing the server’s rows away',
                        // The same `prepare` the arm above carries, and for the counter rather than
                        // for the fixture: `benchHost` opens by disposing the PREVIOUS arm's tree,
                        // and a work bench runs each arm once in order — so without this, arm 2
                        // counts arm 1's teardown and the vanilla arm counts arm 2's.
                        prepare: () => void benchHost(SMALL.served),
                        run: () => hold(mount(benchHost(SMALL.served), SMALL.view)),
                    },
                    {
                        label: 'vanilla — walk the rows and keep their text nodes',
                        prepare: () => void benchHost(SMALL.byHand),
                        run: () =>
                            void vanilla.adoptRows(benchHost(SMALL.byHand).firstElementChild as Element),
                    },
                ],
            },
        },

        {
            title: 'a row that opens and closes in whitespace costs n−1 splits, and that is what {#for} emits',
            note: 'The case above adopts five rows for ONE mutation, which is the number this suite is known for — and it is measured on a row whose markup starts at `<` and ends at `>`. A `{#for}` does not emit that. `{#for row of rows}\\n  <li>…</li>\\n{/for}` compiles to a row template with static whitespace at both ends, and two adjacent rows then arrive from the server as ONE text node, because the parser has no reason to keep them apart. Splitting it at adopt time is what gives each row a disjoint range, without which a later move takes or leaves its neighbour’s whitespace. So the cost is real and so is the reason: one split per boundary, kept here beside the 1 so neither number can be read as the other. What would make it 0 is deferring the split to the first move — a trade against the disjoint-range invariant, not a free win. This case read 2n−1 until a browser ran it: `splitText` is native there and calls nothing the counters patch, while the emulator implements it over an insert and a text write — so the old number was the emulator’s, and every one of these four mutations was one the document never saw.',
            async run({ is, log }) {
                const rows = state(build(5))
                const view = spacedListView(() => rows())
                const host = await served(view)
                const before = Array.from(host.querySelectorAll('li'))
                is('the server wrote five rows', before.length, 5)

                const work = measure(() => void hydrate(host, view))
                // The anchor, and one split per boundary — nothing else moves.
                is('one insert, the root anchor', work.insert, 1)
                is('splits, one per boundary', work.splitText, 4)
                is('nothing was rewritten', work.textWrite, 0)
                is('total DOM work is n', total(work), 5)
                // Each row now owns its own whitespace, which is the invariant the split is for: the
                // text between two rows is two nodes, not the one the parser handed over.
                const between = Array.from(host.querySelectorAll('li'))
                    .slice(0, 4)
                    .map((li) => (li.nextSibling as Text).data)
                is('every row closes in its own text node', between, ['\n    ', '\n    ', '\n    ', '\n    '])
                // Still no rebuild — the rows themselves are adopted, which is the claim that holds
                // for both shapes. What differs is the whitespace between them.
                is('nothing created', work.createElement, 0)
                is('every row is the SAME element', Array.from(host.querySelectorAll('li')), before)
                log('work to adopt five spaced rows', nonZero(work))
                host.remove()
            },
        },

        {
            title: 'hydrating 100 rows against building them',
            note: 'The ratio, not the milliseconds. Adoption walks the markup the parser already built; a mount builds a second copy of it and then discards the first. The vanilla arm is the floor: it walks the same nodes and keeps references, without having to recover from the markup what the author already knew.',
            bench: {
                kind: 'time',
                per: { n: 100, label: 'row' },
                arms: [
                    {
                        label: 'abide — hydrate',
                        run: () => hold(hydrate(benchHost(SMALL.served), SMALL.view)),
                    },
                    {
                        label: 'abide — mount (build it again)',
                        run: () => hold(mount(benchHost(SMALL.served), SMALL.view)),
                    },
                    {
                        label: 'vanilla — walk and keep',
                        run: () =>
                            void vanilla.adoptRows(benchHost(SMALL.byHand).firstElementChild as Element),
                    },
                ],
            },
        },

        {
            title: 'a bench arm takes down the iteration before it',
            note: 'The claim is about the HARNESS, and it is here because the benches below are what broke without it. Dropping an arm’s host does not free what it built: the list slot is subscribed to the cell it reads, so the effect outlives the nodes and holds the whole part tree. Every iteration then retains one more, the numbers stay correct throughout, and at 10000 rows over a calibrated run it is upwards of a million nodes the collector cannot touch — Safari reloads the tab and the run dies with it. Nothing about a duration could show that, and neither could a DOM counter: what grows is the number of readers still subscribed, so the assertion is wake-ups. One live mount is what a page has; the rest is a leak with no symptom until the tab is gone.',
            async run({ is, log }) {
                const rows = state([1, 2, 3])
                let runs = 0
                const view = (): TemplateResult =>
                    html`<ul>${() => {
                        runs++
                        return rows().map((n) => keyed(n, html`<li>${n}</li>`))
                    }}</ul>`

                // Exactly what an arm does: build, drop the host, keep going. `benchHost` is the one
                // that disposes, so going through it is what makes this the arms' own path.
                for (let i = 0; i < 20; i++) hold(mount(benchHost(''), view))
                await tick()
                runs = 0
                rows.set([1, 2, 4])
                await tick()
                // ONE, not twenty. With the dispose out this reads 20 — and read 20 for the whole of
                // the run that killed the tab, while every number the page printed stayed right.
                is('one live reader after twenty iterations', runs, 1)
                log('readers woken by one write', runs)

                // And the live one still works, which is the half that stops "dispose everything"
                // passing: an arm whose mount was torn down measures a mount into nothing.
                const host = benchHost('')
                hold(mount(host, view))
                await tick()
                is('the mount that is still held painted', host.querySelectorAll('li').length, 3)
            },
        },

        roundTrip(SMALL, ROUND_TRIP_NOTE),
        roundTrip(MEDIUM, MEDIUM_NOTE),
        roundTrip(LARGE, LARGE_NOTE),

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

        {
            title: 'a served page patches ITSELF in — the claim a written-in document cannot make',
            note: 'The pair to the case below, and the reason both exist. Bytes WRITTEN into a frame inherit the host page’s Content-Security-Policy: this app serves a nonce-based one, so a rendered document’s inline `$p` scripts are blocked and the deferred region never swaps — the markup is all there, the placeholder just stays. A frame NAVIGATED to a path carries the response’s own headers instead, nonces included, so the scripts run and the page patches itself exactly as a reader’s browser does. Nothing here simulates the swap; `/streaming` is a real route of this app, served by the same server, and what is asserted is what it did. This is also the finding that decides where an isolated demo lives: a route, not a string.',
            async visit({ is, log }, frame) {
                // A short wait, so the case is not a case about 300ms. The route bounds it either way.
                await frame.go('/streaming?ms=40')

                const inner = frame.document
                is('the page loaded', inner.readyState, 'complete')
                log('title', inner.title)

                // The placeholder the shell went out with is GONE, and the settled arm is in its
                // place — which only happens if the document ran the two lines the server sent.
                const settled = Array.from(inner.querySelectorAll('.is-ahead')).map((node) => node.textContent)
                log('what the patches brought', settled.join(' · '))
                is('both deferred panels landed', settled.length, 2)
                is('the slow one settled', settled[0], 'the load settled')
                is('and the fast one', settled[1], 'the fast load settled')
                is('no placeholder is left', inner.body.textContent?.includes('waiting 40ms…'), false)
            },
        },

        {
            title: 'adoption works in a document that is not this one',
            note: 'Every other case here adopts inside the page running it — same realm, same stylesheet, same document that has already hydrated once. This one adopts inside a frame, which is what an isolated demo is made of, and the claim is the same four zeros: a client that rebuilt would produce an identical screen at full cost. Two things were checked by breaking them rather than reasoned about. It does NOT depend on the frame’s realm being instrumented — with `install` removed from `framed` the counts here do not move, because the runtime doing the adopting lives in the PAGE, so its work is billed there; the case next door is the one that gates the per-realm install, and it goes red without it. And it deliberately does not let the document run its own scripts: a frame written into inherits the host page’s Content-Security-Policy, this app serves a nonce-based one, and an inline `$p` patch is blocked before it executes. A served document that patches ITSELF in needs a real response of its own — a route, not a write.',
            async visit({ is, log }, frame) {
                const name = state('ada')
                const view = (): TemplateResult => html`<p class=${() => 'row'}>hello ${() => name()}!</p>`

                // Warmed exactly as `served()` warms every other case here, and for the reason written
                // there: a call site is PARSED once, and that cost is the template cache's rather than
                // adoption's. Cold, this case reported a created element, an `innerHTML` and a removed
                // attribute — the prepare, billed to the hydrate.
                mount(document.createElement('div'), view).dispose()

                await frame.write(`<!doctype html><html><body>${await renderToString(view(), { hydratable: true })}</body></html>`)
                const root = frame.document.body
                is('the server’s markup is in the frame', root.querySelector('p')?.textContent, 'hello ada!')
                const paragraph = root.querySelector('p')

                const work = measure(() => void hydrate(root, view))
                log('work to adopt, in another realm', nonZero(work))
                // FIRST, because four zeros are also what a counter that saw nothing reports. One
                // insertion is the root anchor: it is the line that says an adoption happened at all
                // rather than that one quietly did not.
                is('the anchor is the one node adoption adds', work.insert, 1)
                is('nothing built', work.createElement, 0)
                is('nothing removed', work.remove, 0)
                is('no text rewritten', work.textWrite, 0)
                is('no attribute rewritten', work.setAttribute, 0)
                is('the element is the one the frame’s parser made', root.querySelector('p'), paragraph)

                // Adopted, not merely left alone — the binding is live across the realm boundary.
                await measureFlush(() => name.set('grace'))
                is('and the write lands in the frame', root.querySelector('p')?.textContent, 'hello grace!')
            },
        },

        {
            title: 'a served DOCUMENT leaves nothing in the hydration root but the page',
            note: 'The one thing a fragment render cannot be asked. A page whose content sits behind a deferred region is sent as a placeholder, and the real subtree follows in a `<template>` with a `<script>` that swaps it in — and `renderDocument` wrote all three BEFORE the close of the hydration root, so the top-level part was handed its own markup with a script or two on the end of it. It mismatched and rebuilt the entire page it had been given correct markup for: identical screen, twice the work, and a warning nobody reads. Every served page with a `{#if x.pending()}` over its content did this, `/streaming` since long before the pages that inherited it. Nothing wanted them inside — `$p` finds its placeholder by id from anywhere in the document — so the root now closes ahead of the drain. The counters are the claim, since a rebuild produces the same screen; the assertion that the root holds no script is what says why.',
            async run({ is, log }) {
                const arms = {
                    pending: () => html`<em>waiting</em>`,
                    then: (value: string) => html`<b>${value}</b>`,
                }
                // Unsettled at render time, which is what makes the server DEFER it rather than await
                // it inline — a resolved promise takes the in-order path and the patch never exists.
                const view = (): TemplateResult =>
                    html`<main>${() => awaited(sleep(5).then(() => 'landed'), arms)}</main>`

                const body = await servedDocument(view)
                const root = body.querySelector('slot') as HTMLElement
                // Read off the ELEMENT the patch brought rather than off the root, so a leftover
                // script's own source text cannot fail this line ahead of the one that names it.
                is('the patch landed', root.querySelector('b')?.textContent, 'landed')
                is('no script inside the root', root.querySelector('script'), null)
                is('and no template either', root.querySelector('template'), null)
                // Both are still in the DOCUMENT — moved out of the root, not dropped.
                is('the patch script is outside it', body.querySelectorAll('script').length, 2)

                const main = root.querySelector('main')
                const bold = root.querySelector('b')
                const work = measure(() => void hydrate(root, view))
                // The page is adopted, patched subtree and all. A root that rebuilt reads identically
                // — these are the lines that tell the two apart.
                is('nothing cloned', work.cloneNode, 0)
                is('nothing created', work.createElement, 0)
                is('nothing removed', work.remove, 0)
                is('one node inserted — the root anchor', work.insert, 1)
                is('the page is the element the parser made', root.querySelector('main'), main)
                is('and so is what the patch brought', root.querySelector('b'), bold)
                log('work to adopt a patched document', nonZero(work))
                body.remove()
            },
        },

        {
            title: 'a PROBED region hydrates onto the answer, not back to its placeholder',
            note: 'The case above is the `awaited` shape, and `ChildPart` has a branch for it: whatever the server sent for that subtree is already the settled arm, so hydration takes it rather than asking the probe again. A region that defers because it PROBED has no such marker — it is an ordinary thunk that happened to ask — and the client that runs it has a COLD cell, because cells do not cross the wire. So the probe kicks, reports `pending`, and the first pass paints the placeholder over the answer the patch already installed: value, then `waiting`, then value. Correct output the whole way, which is why the assertion is the WRITE COUNT. The cell is invalidated before hydrating because one process holds both halves here; a browser gets the cold cell for free.',
            async run({ is, log }) {
                const answer = memo(async () => {
                    await sleep(5)
                    return 'landed'
                })
                // No `awaited`, no `{#if}` — the thunk a ternary compiles to.
                const view = (): TemplateResult =>
                    html`<main>${() => (answer.pending() ? 'waiting' : answer())}</main>`

                const body = await servedDocument(view)
                const root = body.querySelector('slot') as HTMLElement
                is('the patch landed', root.querySelector('main')?.textContent, 'landed')

                // What a browser has: markup carrying the answer, and a cell that has never loaded.
                answer.invalidate()

                const work = measure(() => void hydrate(root, view))
                is('no text rewritten', work.textWrite, 0)
                is('nothing removed', work.remove, 0)
                is('the answer is still on screen', root.querySelector('main')?.textContent, 'landed')
                log('work to adopt a probed region', nonZero(work))
                await sleep(20)
                is('and the settle adopted rather than repainted', work.textWrite, 0)
                body.remove()

                // The guard is CONDITIONAL on adopting, and this is the half that says so: with no
                // markup to keep, the same view must paint its placeholder and then the answer.
                // Made unconditional — the obvious simplification — a mounted page shows nothing
                // while it loads and every test above still passes.
                answer.invalidate()
                const fresh = container()
                const live = mount(fresh, view)
                is('a mounted region shows the placeholder', fresh.textContent, 'waiting')
                await sleep(20)
                is('…and then the answer', fresh.textContent, 'landed')
                live.dispose()
                fresh.remove()
            },
        },

    ],
})
