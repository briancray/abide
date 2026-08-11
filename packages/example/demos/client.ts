// The client substrate: `mount`, per-slot effects, parse-once templates, keyed lists, disposal.
//
// The claims here are about WORK, not output, so the cases COUNT DOM calls: a binding that assigns
// the value already present produces identical markup at full DOM cost, and only a counter can tell
// the two apart. Effects are microtask-batched, so every measurement brackets the write AND the
// flush — the effect is what touches the DOM, not the write.

import { html, memo, state, type State, type TemplateResult } from 'abide'
import { awaited, keyed } from 'abide/runtime'
import {
    container,
    countCalls,
    install,
    keep,
    measureFlush,
    nodesMade,
    nonZero,
    settled,
    sleep,
    suite,
    tick,
    total,
    until,
} from 'abide/tests'
import { mount } from 'abide/ui'
import { button, field, lazy, row, stage } from './dom.ts'
import { META } from './SUITES.ts'
import * as vanilla from './vanilla.ts'

install()

// The rows every arm starts from come from the vanilla module, so the abide arm and the arm it is
// measured against are handed the SAME data rather than two builders that agree by inspection.
type Item = vanilla.Row

const build = (n: number): Item[] => vanilla.rows(n)

function swapped(items: Item[], a: number, b: number): Item[] {
    const next = items.slice()
    const held = next[a] as Item
    next[a] = next[b] as Item
    next[b] = held
    return next
}

/**
 * One row taken out and put back somewhere else — a reorder that is NOT a transposition, which is
 * what separates the swap fast path from the walk behind it. Which DIRECTION is the other half: the
 * walk runs backwards, so the two directions of the same move cost very differently.
 */
function lifted(items: Item[], from: number, to: number): Item[] {
    const next = items.slice()
    const [held] = next.splice(from, 1)
    next.splice(to, 0, held as Item)
    return next
}

function rand(): string {
    return Math.random().toString(36).slice(2, 6)
}

const list = (rows: () => Item[]): TemplateResult =>
    html`<ul class="font-mono text-xs">
        ${() => rows().map((item) => html`<li>${item.label}</li>`)}
    </ul>`

const keyedList = (rows: () => Item[]): TemplateResult =>
    html`<ul class="font-mono text-xs">
        ${() => rows().map((item) => keyed(item.id, html`<li>${item.label}</li>`))}
    </ul>`

// --- a transcript with a live tail ------------------------------------------
//
// The shape every list above is missing, and the one a token stream has: the list is LONG and STILL
// while ONE row at the end changes tens of times a second. Every other list case here moves rows or
// edits many at once, and both amortise the framework's per-update cost over hundreds of rows. A
// token amortises nothing — it pays that cost sixty times a second — and nothing else in this suite
// can see it.
//
// The two arms differ in how the APP spells "the tail got longer", not in what the framework does,
// and the DOM cannot tell them apart: both write one text node and create nothing.

interface ChatArm {
    /** Put `text` in the tail message. */
    setTail(text: string): void
    /** How many times a message body has been DESCRIBED — the number no DOM counter can show. */
    readonly describes: number
    dispose(): void
}

/** A message that owns its text, so a token is a write to that message and nothing else. */
interface OwnedMessage {
    id: number
    text: State<string>
}

/**
 * The tail message OWNS its text.
 *
 * `${message.text}` hands the slot the CELL rather than a string — `unwrap` calls it inside that
 * slot's own effect, so the subscription belongs to one message and the list slot never re-runs.
 */
function chatOwningTail(host: HTMLElement, depth: number): ChatArm {
    const messages: OwnedMessage[] = []
    for (let i = 0; i < depth; i++) messages.push({ id: i, text: state(`message ${i}`) })
    const log = state(messages)
    const counted = { describes: 0 }
    const mounted = mount(
        host,
        () =>
            html`<ul>${() =>
                log().map((message) => {
                    counted.describes++
                    return keyed(message.id, html`<li>${message.text}</li>`)
                })}</ul>`,
    )
    const tail = messages[depth - 1] as OwnedMessage
    return {
        setTail: (text) => tail.text.set(text),
        get describes() {
            return counted.describes
        },
        dispose: () => mounted.dispose(),
    }
}

/** The spelling everyone writes first: a fresh array with a fresh tail element, per token. */
function chatRebuildingArray(host: HTMLElement, depth: number): ChatArm {
    const messages: Item[] = []
    for (let i = 0; i < depth; i++) messages.push({ id: i, label: `message ${i}` })
    const log = state(messages)
    const counted = { describes: 0 }
    const mounted = mount(
        host,
        () =>
            html`<ul>${() =>
                log().map((message) => {
                    counted.describes++
                    return keyed(message.id, html`<li>${message.label}</li>`)
                })}</ul>`,
    )
    return {
        setTail(text) {
            const next = log.peek().slice()
            next[depth - 1] = { id: (next[depth - 1] as Item).id, label: text }
            log.set(next)
        },
        get describes() {
            return counted.describes
        },
        dispose: () => mounted.dispose(),
    }
}

/** The text on screen in the last message, read from the document rather than from the model. */
function tailOnScreen(host: HTMLElement): string {
    const items = host.querySelectorAll('li')
    return items[items.length - 1]?.textContent ?? ''
}

/** How deep the transcript is under the live tail. Deep enough that describing it all is visible. */
const CHAT_DEPTH = 200

// --- bench fixtures ---------------------------------------------------------
//
// Detached: the benches must not be measuring layout and paint of a visible list. Built once, so an
// arm is timed on a WARM list rather than on its own first render.
//
// The DATA is built at module scope and the DOM is not, and the split is not tidiness: a suite module
// is imported on the SERVER too — the cards' titles and notes are server-rendered — and there is no
// document there to build a list in. So the elements come on first use, which is inside an arm, which
// only ever runs in a browser.

const ROWS_1000 = build(1000)
const ROWS_200 = build(200)
// Ten thousand ROWS, but no ten-thousand-row list standing anywhere: the array is cheap and the DOM
// is not, so the build arms make theirs and tear it down again.
const ROWS_10000 = build(10000)
const ROWS_1010 = build(1010)

// The two reorders, precomputed. A timed reorder arm ALTERNATES between two orders rather than
// preparing once: a list already in the order it is being set to moves nothing, so an arm that
// swapped the same pair every iteration would time the first op and then time nothing.
const SWAP_ADJACENT = swapped(ROWS_200, 1, 2)
const SWAP_DISTANT = swapped(ROWS_200, 1, 198)

// The cells the persistent lists track. Reactive state, not DOM — they belong out here with the rows.
const liveRows = state(ROWS_1000)
// The same thousand rows KEYED, for the same one-row edit: a keyed list whose order did not change
// is the case the reorder arms cannot show, and the one that says whether the key index is built
// for a pass that has nothing to look up in it.
const keyedLiveRows = state(ROWS_1000)
// The same append, KEYED — the case the guard on the index build is for: every previous row is
// claimed by position before the walk reaches the new tail, so an index built there could only miss.
const keyedGrowRows = state(ROWS_1000)
const keyedRows = state(ROWS_200)
const unkeyedRows = state(ROWS_200)
const adjacentRows = state(ROWS_200)
const distantRows = state(ROWS_200)
const growRows = state(ROWS_1000)

/** One record, so the whole set is one shape the JIT sees the same way at every arm's call site. */
interface Fixtures {
    detached: HTMLElement
    listHost: HTMLElement
    bigListHost: HTMLElement
    liveHost: HTMLElement
    keyedLiveHost: HTMLElement
    keyedGrowHost: HTMLElement
    keyedHost: HTMLElement
    unkeyedHost: HTMLElement
    vanillaHost: HTMLElement
    vanillaBigHost: HTMLElement
    innerHost: HTMLElement
    adjacentHost: HTMLElement
    distantHost: HTMLElement
    growHost: HTMLElement
    growVanillaHost: HTMLElement
}

const fixtures = lazy((): Fixtures => {
    const detached = document.createElement('div')
    const ul = (): HTMLElement => {
        const host = document.createElement('ul')
        detached.append(host)
        return host
    }

    const listHost = ul()
    const bigListHost = ul()

    // One persistent abide list, kept in sync with a cell — the "update one row of a thousand" arm.
    const liveHost = ul()
    mount(liveHost, () => list(liveRows))

    // …and the same list keyed, for the same edit: the arm that prices a keyed pass in which every
    // row is still at its own index.
    const keyedLiveHost = ul()
    mount(keyedLiveHost, () => keyedList(keyedLiveRows))

    // …and the keyed equivalent, for the reorder cases.
    const keyedHost = ul()
    mount(keyedHost, () => keyedList(keyedRows))

    // …and an UNKEYED one over the same data, which is the arm a keyed swap has to beat.
    const unkeyedHost = ul()
    mount(unkeyedHost, () => list(unkeyedRows))

    const vanillaHost = ul()
    vanilla.buildRows(vanillaHost, ROWS_200)

    const vanillaBigHost = ul()
    vanilla.buildRows(vanillaBigHost, ROWS_1000)

    const innerHost = ul()
    vanilla.buildRowsInnerHTML(innerHost, ROWS_1000)

    const adjacentHost = ul()
    mount(adjacentHost, () => keyedList(adjacentRows))

    const distantHost = ul()
    mount(distantHost, () => keyedList(distantRows))

    // Growth: a thousand rows with ten more on the end, alternating. This is what a feed does on
    // every poll, and it is the mutation the whole-array benches above cannot show — a reconcile that
    // is right for an edit can still rebuild the tail.
    const growHost = ul()
    mount(growHost, () => list(growRows))

    const keyedGrowHost = ul()
    mount(keyedGrowHost, () => keyedList(keyedGrowRows))

    const growVanillaHost = ul()
    vanilla.buildRows(growVanillaHost, ROWS_1000)

    return {
        detached,
        listHost,
        bigListHost,
        liveHost,
        keyedLiveHost,
        keyedGrowHost,
        keyedHost,
        unkeyedHost,
        vanillaHost,
        vanillaBigHost,
        innerHost,
        adjacentHost,
        distantHost,
        growHost,
        growVanillaHost,
    }
})

/**
 * The three transcripts the token arms write into, built once and left standing.
 *
 * Separate from `fixtures` because these are not hosts — each carries the arm's own handle on its
 * tail, which is the whole of what a hand-written chat keeps and therefore the thing the abide arms
 * have to be measured against.
 */
const chats = lazy((): { owning: ChatArm; rebuilding: ChatArm; byHand: vanilla.VanillaChat } => {
    const detached = fixtures().detached
    const div = (): HTMLElement => {
        const host = document.createElement('div')
        detached.append(host)
        return host
    }
    const byHandHost = document.createElement('ul')
    detached.append(byHandHost)
    return {
        owning: chatOwningTail(div(), CHAT_DEPTH),
        rebuilding: chatRebuildingArray(div(), CHAT_DEPTH),
        byHand: vanilla.buildChat(byHandHost, CHAT_DEPTH),
    }
})

export default suite({
    ...META.client,
    cases: [
        {
            title: 'mount — one effect per slot, not one per render',
            note: 'Writing `count` re-runs that slot’s binding and nothing else. The counters are the proof: one text write, no elements created, nothing inserted.',
            async run({ is, log }) {
                const count = state(0)
                const name = state('ada')
                const host = container()
                mount(
                    host,
                    () =>
                        html`<p><span>name</span> ${() => name()} · <span>count</span> ${() => count()}</p>`,
                )
                is('the first paint', host.querySelector('p')?.textContent, 'name ada · count 0')

                const work = await measureFlush(() => count.set(1))
                is('one count write — text writes', work.textWrite, 1)
                is('…and nothing else', work.createElement + work.insert + work.setAttribute, 0)
                is('the DOM', host.querySelector('p')?.textContent, 'name ada · count 1')
                log('work for one count write', nonZero(work))
                host.remove()
            },
            interact({ host, log }) {
                const count = state(0)
                const name = state('ada')
                const out = stage(host)
                mount(
                    out,
                    () => html`
                        <p class="text-slate-100">
                            <span class="text-slate-500">name</span> ${() => name()} ·
                            <span class="text-slate-500">count</span> ${() => count()}
                        </p>
                    `,
                )
                host.append(
                    row(
                        button('count.set(count + 1)', async () => {
                            const work = await measureFlush(() => count.set(count.peek() + 1))
                            log.live('work for one count write', nonZero(work))
                        }),
                        button('name.set(random)', async () => {
                            const work = await measureFlush(() => name.set(rand()))
                            log.live('work for one name write', nonZero(work))
                        }),
                    ),
                )
            },
        },

        {
            title: 'a binding that would write the SAME value writes nothing',
            note: 'Asserted by call count, not by output: the wrong implementation produces identical markup at full DOM cost.',
            async run({ is }) {
                const level = state('high')
                const label = state('steady')
                const host = container()
                mount(host, () => html`<p class=${() => level()}>${() => label()}</p>`)

                const same = await measureFlush(() => {
                    level.set('high')
                    label.set('steady')
                })
                is('setting both to the values already held', same.textWrite + same.setAttribute, 0)

                const moved = await measureFlush(() => {
                    level.set('low')
                    label.set('moving')
                })
                is('a real move writes the text once', moved.textWrite, 1)
                is('…and the attribute once', moved.setAttribute, 1)
                host.remove()
            },
            interact({ host, log }) {
                const level = state('high')
                const label = state('steady')
                const out = stage(host)
                mount(out, () => html`<p class=${() => level()}>${() => label()}</p>`)
                // The claim is that a write costs NOTHING, and an empty work record looks the same
                // whether the button ran or was never wired up — so the clicks are counted too.
                let writes = 0
                host.append(
                    row(
                        button('set both to the SAME values', async () => {
                            const work = await measureFlush(() => {
                                level.set('high')
                                label.set('steady')
                            })
                            log.live('writes', ++writes)
                            log.live('same values', nonZero(work))
                        }),
                        button('set both to NEW values', async () => {
                            const work = await measureFlush(() => {
                                level.set(`l${rand()}`)
                                label.set(`s${rand()}`)
                            })
                            log.live('writes', ++writes)
                            log.live('new values', nonZero(work))
                        }),
                    ),
                )
            },
        },

        {
            title: 'an unrelated attribute is not rewritten',
            note: 'Two attribute slots on one element; one of them moves. `setAttribute` is counted directly, because both spellings produce the same markup.',
            async run({ is }) {
                const cls = state('a')
                const other = state(0)
                const host = container()
                mount(host, () => html`<i class=${() => cls()} data-n=${() => String(other())}>x</i>`)

                const spy = countCalls(Element.prototype, 'setAttribute')
                other.set(1) // moves only data-n
                await tick()
                spy.restore()

                is('data-n', host.querySelector('i')?.getAttribute('data-n'), '1')
                is('class was not touched', spy.calls, 1)
                host.remove()
            },
        },

        {
            title: 'only the changed row is touched in a list',
            note: '1000 rows, one of them edited. A whole-list rebuild produces the same screen and a thousand times the work. The hand-written arm wins on TIME and always will — it walks nothing, because the author already knew which row it was — so the arm to read the abide one against is the third: setting an array asks for the whole list to be described again, and describing it is most of what the op costs before any reconciling starts.',
            async run({ is, log }) {
                const rows = state(build(1000))
                const host = container()
                mount(host, () => list(rows))
                is('1000 rows', host.querySelectorAll('li').length, 1000)
                const nodes = Array.from(host.querySelectorAll('li'))

                const work = await measureFlush(() => {
                    const next = rows.peek().slice()
                    next[500] = { id: 500, label: 'row 500 · edited' }
                    rows.set(next)
                })
                is('one text write for one edited row', work.textWrite, 1)
                // `createElement` alone could not carry this claim: abide clones a prepared template
                // rather than building elements by hand, so that counter is zero here whether one row
                // changed or the whole list was rebuilt. Every node-making operation is counted.
                is('nothing was created', nodesMade(work), 0)
                is('nothing was moved', work.insert, 0)
                is('the edit landed', nodes[500]?.textContent, 'row 500 · edited')
                is('and every other row is the SAME element', host.querySelectorAll('li')[999], nodes[999])
                log('one edited row of 1000', nonZero(work))
                host.remove()
            },
            interact({ host, log }) {
                const rows = state(build(1000))
                const out = stage(host, 'live (scroll)')
                out.className += ' max-h-40 overflow-auto'
                mount(out, () => list(rows))
                host.append(
                    row(
                        button('edit row 500', async () => {
                            const work = await measureFlush(() => {
                                const next = rows.peek().slice()
                                next[500] = { id: 500, label: `row 500 · edited ${rand()}` }
                                rows.set(next)
                            })
                            log.live('one edited row of 1000', nonZero(work))
                        }),
                        button('append 10 rows', async () => {
                            const work = await measureFlush(() => {
                                const next = rows.peek().slice()
                                for (let i = 0; i < 10; i++)
                                    next.push({ id: next.length, label: `row ${next.length}` })
                                rows.set(next)
                            })
                            log.live('ten appended rows', nonZero(work))
                        }),
                    ),
                )
            },
            bench: {
                kind: 'time',
                floor: 'flush',
                arms: [
                    {
                        label: 'abide — set the array, one text write',
                        run: async (i: number) => {
                            const next = ROWS_1000.slice()
                            next[500] = { id: 500, label: `row 500 · ${i}` }
                            liveRows.set(next)
                            await settled()
                        },
                    },
                    {
                        // The same edit on a KEYED list, and the reason the arm is here: every row
                        // is still at its own index, so the reconcile finds each one by position and
                        // the key index is never built. Building it up front instead cost 0.234 ms
                        // against this arm's 0.172 — a `Map.set` and a `Map.get` per row to be told
                        // what `previous[i]` already said. The reorder cases above are the other
                        // half: there the index IS built, and they say that costs nothing extra.
                        label: 'abide — the same edit, KEYED rows in unchanged order',
                        run: async (i: number) => {
                            const next = ROWS_1000.slice()
                            next[500] = { id: 500, label: `row 500 · ${i}` }
                            keyedLiveRows.set(next)
                            await settled()
                        },
                    },
                    {
                        label: 'vanilla — surgical textContent',
                        run: (i: number) =>
                            vanilla.updateRow(fixtures().vanillaBigHost, 500, `row 500 · ${i}`),
                    },
                    {
                        // Neither abide nor a rebuild: the slice and the thousand `html` tags the
                        // SLOT THUNK evaluates before either of them is reached. Setting an array is
                        // asking for the whole list to be described again, and describing it is not
                        // free — so this is the floor the shape imposes, and the difference between
                        // it and the abide arm is what the reconcile itself costs.
                        label: 'the API floor — build the 1000 results, reconcile nothing',
                        run: (i: number) => {
                            const next = ROWS_1000.slice()
                            next[500] = { id: 500, label: `row 500 · ${i}` }
                            keep(next.map((item) => html`<li>${item.label}</li>`))
                        },
                    },
                    {
                        label: 'vanilla — innerHTML rebuild',
                        run: (i: number) => {
                            const next = ROWS_1000.slice()
                            next[500] = { id: 500, label: `row 500 · ${i}` }
                            vanilla.buildRowsInnerHTML(fixtures().innerHost, next)
                        },
                    },
                ],
            },
        },

        {
            title: 'update one row of a thousand — the DOM CALLS',
            note: 'The same three arms, counted instead of timed. Time says the surgical hand-written version wins — it walks nothing, because the author already knew which row it was. The counters say abide does the same amount of DOM work to get there, which is the part a rebuild cannot match at any size.',
            bench: {
                kind: 'work',
                arms: [
                    {
                        label: 'abide — one text write',
                        run: () => {
                            const next = ROWS_1000.slice()
                            next[500] = { id: 500, label: `row 500 · counted ${Math.random()}` }
                            liveRows.set(next)
                        },
                    },
                    {
                        label: 'vanilla — surgical textContent',
                        run: () =>
                            vanilla.updateRow(
                                fixtures().vanillaBigHost,
                                500,
                                `row 500 · counted ${Math.random()}`,
                            ),
                    },
                    {
                        label: 'vanilla — innerHTML rebuild',
                        run: () => vanilla.buildRowsInnerHTML(fixtures().innerHost, ROWS_1000),
                    },
                ],
            },
        },

        {
            title: 'build 1000 rows from cold',
            note: 'Teardown included on every arm, so each one pays for a full build. `innerHTML` is the one to beat on build; it is also the one that loses every update case.',
            bench: {
                kind: 'time',
                per: { n: 1000, label: 'row' },
                arms: [
                    {
                        label: 'abide — mount + dispose',
                        run: () => {
                            const mounted = mount(
                                fixtures().listHost,
                                () => html`${ROWS_1000.map((r) => html`<li>${r.label}</li>`)}`,
                            )
                            mounted.dispose()
                        },
                    },
                    {
                        label: 'vanilla — createElement loop',
                        run: () => {
                            vanilla.buildRows(fixtures().listHost, ROWS_1000)
                            fixtures().listHost.replaceChildren()
                        },
                    },
                    {
                        label: 'vanilla — innerHTML',
                        run: () => {
                            vanilla.buildRowsInnerHTML(fixtures().listHost, ROWS_1000)
                            fixtures().listHost.innerHTML = ''
                        },
                    },
                ],
            },
        },

        {
            title: 'build 10000 rows from cold',
            note: 'The same three arms as the thousand-row build, ten times the size — and the two are meant to be read together, because the number that matters is PER ROW. One size cannot tell a per-row cost from a fixed one: both look like a constant. Measured cold in a fresh page, the vanilla arms hold their per-row cost across the two sizes and abide does NOT — it is several times cheaper per row here than at a thousand, which says a size-independent cost dominates the smaller list. Read this one in a FRESH page: ten thousand nodes an op leaves enough garbage that a case run after it measures this one.',
            bench: {
                kind: 'time',
                per: { n: 10000, label: 'row' },
                arms: [
                    {
                        label: 'abide — mount + dispose',
                        run: () => {
                            const mounted = mount(
                                fixtures().bigListHost,
                                () => html`${ROWS_10000.map((r) => html`<li>${r.label}</li>`)}`,
                            )
                            mounted.dispose()
                        },
                    },
                    {
                        label: 'vanilla — createElement loop',
                        run: () => {
                            vanilla.buildRows(fixtures().bigListHost, ROWS_10000)
                            fixtures().bigListHost.replaceChildren()
                        },
                    },
                    {
                        label: 'vanilla — innerHTML',
                        run: () => {
                            vanilla.buildRowsInnerHTML(fixtures().bigListHost, ROWS_10000)
                            fixtures().bigListHost.innerHTML = ''
                        },
                    },
                ],
            },
        },

        {
            title: 'keyed — a reorder MOVES DOM, and a SWAP moves two rows rather than the distance',
            note: 'No element is re-created: every row survives as the same object. Placement is an in-order walk rather than a minimal-move (LIS) reconcile, so in general a move costs the DISTANCE it covers — once the walk moves a row, every row between it and where it came from has the wrong next sibling and is moved in turn. A two-row swap is the shape that walk is worst at and the one the DOM is asked for most, so it is detected instead: the first and last rows of the changed range have traded places, which is three identity checks and no scan, and two ranges move. The last two pairs are what is NOT taken, and they are the same reorder in the two directions — the walk runs backwards from the last change, so sending a row DOWN the list costs one move and pulling the same row back UP costs the distance. That asymmetry is the trade LIS would buy out; on a real re-sort it is worth about 5%, because an uncorrelated permutation needs ~n−2√n moves against the ~n this makes.',
            async run({ is }) {
                for (const [label, reorder, expected] of [
                    ['swap 1↔2 (adjacent)', swapped(build(100), 1, 2), 1],
                    ['swap 1↔20', swapped(build(100), 1, 20), 2],
                    ['swap 1↔98', swapped(build(100), 1, 98), 2],
                    ['send row 1 down to 98', lifted(build(100), 1, 98), 1],
                    ['pull row 98 up to 1', lifted(build(100), 98, 1), 97],
                    // The two that LOOK like a swap at the ends and are not. A reverse trades row 0
                    // with row 99 and moves everything between as well; a rotation trades nothing at
                    // all. Both reach the fast path's identity checks, and both come out with the
                    // right first and last row — which is the whole of what a spot check reads, and
                    // is why these are here as counts rather than as a glance at the page.
                    ['reverse all 100', build(100).slice().reverse(), 99],
                    ['rotate the last row to the front', lifted(build(100), 99, 0), 99],
                ] as const) {
                    const source = build(100)
                    const rows = state(source)
                    const host = container()
                    mount(host, () => keyedList(rows))
                    await tick()
                    const before = new Map(
                        Array.from(host.querySelectorAll('li')).map((li) => [li.textContent, li]),
                    )

                    const spy = countCalls(Node.prototype, 'insertBefore')
                    rows.set(reorder)
                    await tick()
                    spy.restore()

                    const after = Array.from(host.querySelectorAll('li'))
                    is(
                        `${label} — the order`,
                        after.map((li) => li.textContent),
                        reorder.map((item) => `row ${item.id}`),
                    )
                    // Every element is the SAME object it was — the rows moved, nothing was rebuilt.
                    for (const li of after) {
                        if (before.get(li.textContent) !== li) {
                            is(`${label} — "${li.textContent}" was rebuilt`, false, true)
                        }
                    }
                    is(`${label} — moves`, spy.calls, expected)
                    host.remove()
                }
            },
            interact({ host, log }) {
                const rows = state(build(200))
                const out = stage(host, 'live (scroll)')
                out.className += ' max-h-40 overflow-auto'
                mount(out, () => keyedList(rows))
                host.append(
                    row(
                        button('swap rows 1 and 2 (adjacent)', async () => {
                            const work = await measureFlush(() => rows.set(swapped(rows.peek(), 1, 2)))
                            log.live('adjacent swap', nonZero(work))
                        }),
                        button('swap rows 1 and 198 (distant)', async () => {
                            const work = await measureFlush(() => rows.set(swapped(rows.peek(), 1, 198)))
                            log.live('distant swap — two ranges, not the distance', nonZero(work))
                        }),
                        button('pull row 198 up to 1', async () => {
                            const work = await measureFlush(() => rows.set(lifted(rows.peek(), 198, 1)))
                            log.live('one row up 197 places — not a swap, so the distance', nonZero(work))
                        }),
                        button('reverse all 200', async () => {
                            const work = await measureFlush(() => rows.set(rows.peek().slice().reverse()))
                            log.live('full reverse of 200', nonZero(work))
                        }),
                        button('remove row 0', async () => {
                            const work = await measureFlush(() => rows.set(rows.peek().slice(1)))
                            log.live('one removal', nonZero(work))
                        }),
                    ),
                )
                log('', 'the same swap on an UNKEYED list rewrites both rows’ text — see the next case')
            },
            bench: {
                kind: 'work',
                arms: [
                    {
                        label: 'abide — keyed, ADJACENT rows (optimal)',
                        prepare: async () => {
                            keyedRows.set(ROWS_200)
                            await tick()
                        },
                        run: () => keyedRows.set(swapped(ROWS_200, 1, 2)),
                    },
                    {
                        label: 'abide — keyed, DISTANT rows (a swap, so two ranges)',
                        prepare: async () => {
                            keyedRows.set(ROWS_200)
                            await tick()
                        },
                        run: () => keyedRows.set(swapped(ROWS_200, 1, 198)),
                    },
                    {
                        label: 'abide — unkeyed, same data (rewrites two rows’ text)',
                        prepare: async () => {
                            unkeyedRows.set(ROWS_200)
                            await tick()
                        },
                        run: () => unkeyedRows.set(swapped(ROWS_200, 1, 198)),
                    },
                    {
                        label: 'vanilla — two insertBefore calls',
                        run: () => vanilla.swapRows(fixtures().vanillaHost, 1, 198),
                    },
                    {
                        label: 'vanilla — innerHTML rebuild',
                        run: () =>
                            vanilla.buildRowsInnerHTML(fixtures().innerHost, swapped(ROWS_200, 1, 198)),
                    },
                ],
            },
        },

        {
            title: 'a row of THREE nodes is in place on the same terms as a row of one',
            note: 'The placement walk leaves a row alone when it is already where it belongs, and what answers that is where the row ENDS: its last node has to be followed by the row after it. Asking `firstNode().nextSibling` instead answers it only for a row that is exactly one node — a multi-node row has its OWN second node sitting there, so the test can never succeed and every row below the change is re-inserted to find that out. The output is identical either way, which is why this is a ratio between two row SHAPES rather than a screenshot: drop the first of 200 and nothing below it moves, whether a row is one node or three. A single-node row cannot show it, and a single-node row is what a hand-written `<li>` list is — the shapes that are not are `{#for}` over a body with markup at both ends, and any component whose root is a fragment.',
            async run({ is, log }) {
                const dropFirst = async (
                    view: (item: Item) => TemplateResult,
                    perRow: number,
                ): Promise<{ moved: number; labels: (string | null)[] }> => {
                    const rows = state(build(200))
                    const host = container()
                    mount(host, () => html`<ul>${() => rows().map((item) => keyed(item.id, view(item)))}</ul>`)
                    await tick()
                    // Every row below the drop shifts INDEX, so nothing here is outside the walk's
                    // changed range: the rows are reconsidered and then left where they are.
                    const work = await measureFlush(() => rows.set(rows.peek().slice(1)))
                    // Read after the measurement, not inside it — a query is a walk, and the window
                    // is a few microtasks wide. Every shape carries the label in its FIRST node, so
                    // one stride reads the order out of both. That is what stops a zero from being
                    // vacuous: a reconcile that moved nothing AND placed nothing scores the same.
                    const found = host.querySelectorAll('li')
                    const labels: (string | null)[] = []
                    for (let i = 0; i < found.length; i += perRow) labels.push(found[i]?.textContent ?? null)
                    host.remove()
                    return { moved: work.insert, labels }
                }

                const one = await dropFirst((item) => html`<li>${item.label}</li>`, 1)
                const three = await dropFirst(
                    (item) => html`<li>${item.label}</li><li>#${item.id}</li><li>·</li>`,
                    3,
                )
                const expected = build(200)
                    .slice(1)
                    .map((item) => item.label)
                log(
                    'nodes moved dropping the first of 200',
                    `one-node rows — ${one.moved}, three-node rows — ${three.moved}`,
                )
                is('a one-node row leaves the 199 below it alone', one.moved, 0)
                is('…and so does a three-node row', three.moved, one.moved)
                is('the one-node list is in order', one.labels, expected)
                is('and so is the three-node one', three.labels, expected)
            },
        },

        {
            title: 'the same two reorders, TIMED',
            note: 'The counters above say both swaps now move two ranges, the same as a hand-written one. This is the number they cannot give: the DESCRIBING is what a whole-array update costs before any reconciling starts, and it is O(n) whatever the reorder turns out to be — two hundred rows are re-evaluated to swap two of them, and that is the floor the two arms below share. A reconcile that is cheap in moves and linear in describing is priced honestly by having both cards.',
            bench: {
                kind: 'time',
                floor: 'flush',
                arms: [
                    {
                        label: 'abide — keyed, adjacent swap',
                        run: async (i: number) => {
                            adjacentRows.set(i % 2 === 0 ? SWAP_ADJACENT : ROWS_200)
                            await settled()
                        },
                    },
                    {
                        label: 'abide — keyed, distant swap',
                        run: async (i: number) => {
                            distantRows.set(i % 2 === 0 ? SWAP_DISTANT : ROWS_200)
                            await settled()
                        },
                    },
                    {
                        label: 'vanilla — two insertBefore calls',
                        run: () => vanilla.swapRows(fixtures().vanillaHost, 1, 198),
                    },
                    {
                        label: 'vanilla — innerHTML rebuild',
                        run: (i: number) =>
                            vanilla.buildRowsInnerHTML(
                                fixtures().innerHost,
                                i % 2 === 0 ? SWAP_DISTANT : ROWS_200,
                            ),
                    },
                ],
            },
        },

        {
            title: 'ten rows appended to a thousand',
            note: 'What a feed does on every poll, and the mutation the whole-array cases cannot show: a reconcile that is right for an EDIT can still rebuild the tail. The thousand rows already there must be left alone — same elements, no text writes — and only the ten new ones created.',
            async run({ is, log }) {
                const rows = state(build(1000))
                const host = container()
                mount(host, () => list(rows))
                const nodes = Array.from(host.querySelectorAll('li'))

                const work = await measureFlush(() => {
                    const next = rows.peek().slice()
                    for (let i = 0; i < 10; i++) next.push({ id: 1000 + i, label: `row ${1000 + i}` })
                    rows.set(next)
                })
                // abide never calls `createElement` on its build path — it CLONES a prepared
                // template — which is why this case counts clones. A row is two cloned nodes, the
                // `<li>` and its anchor comment, plus the text node the slot makes: a template that
                // IS one element clones that element rather than the fragment around it.
                is('nothing was built by hand', work.createElement, 0)
                is('ten rows cloned, not a thousand', work.cloneNode, 20)
                is('…and ten text nodes with them', work.createText, 10)
                is('no row already there was rewritten', work.textWrite, 0)
                is('the first row is the SAME element', host.querySelectorAll('li')[0], nodes[0])
                is('and the list grew', host.querySelectorAll('li').length, 1010)
                log('ten appended to a thousand', nonZero(work))
                host.remove()
            },
            bench: {
                kind: 'time',
                floor: 'flush',
                arms: [
                    {
                        label: 'abide — set the longer array',
                        run: async (i: number) => {
                            growRows.set(i % 2 === 0 ? ROWS_1010 : ROWS_1000)
                            await settled()
                        },
                    },
                    {
                        // Keyed, and the arm the index guard is measured against: every row of the
                        // thousand is claimed by position, so the ten new ones at the tail have
                        // nothing left to look up and the index is never built.
                        label: 'abide — the same append, KEYED rows',
                        run: async (i: number) => {
                            keyedGrowRows.set(i % 2 === 0 ? ROWS_1010 : ROWS_1000)
                            await settled()
                        },
                    },
                    {
                        label: 'vanilla — append ten, then drop them',
                        run: (i: number) => {
                            if (i % 2 === 0) {
                                const fragment = document.createDocumentFragment()
                                for (let n = 1000; n < 1010; n++) {
                                    const li = document.createElement('li')
                                    li.textContent = `row ${n}`
                                    fragment.append(li)
                                }
                                fixtures().growVanillaHost.append(fragment)
                                return
                            }
                            for (let n = 0; n < 10; n++) fixtures().growVanillaHost.lastChild?.remove()
                        },
                    },
                    {
                        label: 'vanilla — innerHTML rebuild',
                        run: (i: number) =>
                            vanilla.buildRowsInnerHTML(
                                fixtures().innerHost,
                                i % 2 === 0 ? ROWS_1010 : ROWS_1000,
                            ),
                    },
                ],
            },
        },

        {
            title: 'the reconcile is right under ARBITRARY mutation, not just the ones with cases',
            note: 'The placement walk starts at the last row that changed and stops once it is below the first, and a two-row swap skips the walk entirely — which is exactly the kind of reasoning that is right for every mutation somebody thought of. So the mutations are generated: insert, remove, swap, reverse a run, rotate one row, and edit, at random positions, two hundred times, with the whole list checked after every one. Several PER STEP, which is the half that matters: with one mutation per step the first and last changed index are always the two changed rows, so a fast path that confuses "the brackets around the changes" with "the only changes" agrees with the truth by construction and the fuzz can never disagree with it. That confusion shipped once. Run over TWO row shapes as well, because a row that is one element and a row that is a fragment are two different pieces of code — one moves a node and the other moves a range it has to walk out first. The seed is fixed, so a failure is a failure anybody can reproduce.',
            async run({ is }) {
                const fuzz = async (view: (item: Item) => TemplateResult, perRow: number): Promise<number> => {
                    // Every shape carries the label in its FIRST node, so one stride reads the order
                    // out of all of them.
                    const read = (host: HTMLElement): (string | null)[] => {
                        const found = host.querySelectorAll('li')
                        const labels: (string | null)[] = []
                        for (let i = 0; i < found.length; i += perRow) labels.push(found[i]?.textContent ?? null)
                        return labels
                    }
                    const rows = state(build(30))
                    const host = container()
                    mount(
                        host,
                        () => html`<ul>${() => rows().map((item) => keyed(item.id, view(item)))}</ul>`,
                    )
                    await tick()

                    // A fixed seed rather than `Math.random`: a fuzz nobody can re-run is a fuzz that
                    // reports a bug once and never again. Per shape, so both see the same mutations.
                    let seed = 987654
                    const rand = (): number => {
                        seed = (seed * 1103515245 + 12345) % 2147483648
                        return seed / 2147483648
                    }
                    // One mutation per step is what this did first, and it could not have found the
                    // bug it now covers: a placement fast path keyed on the FIRST and LAST changed
                    // index is only ever handed one change, so those two brackets are always the two
                    // changed rows and the two readings agree by construction. Several per step is
                    // what makes them disagree.
                    const mutate = (next: Item[], step: number): void => {
                        const roll = rand()
                        if (roll < 0.24 && next.length > 1) next.splice(Math.floor(rand() * next.length), 1)
                        else if (roll < 0.48) {
                            next.splice(Math.floor(rand() * (next.length + 1)), 0, {
                                id: 5000 + step,
                                label: `new ${step}`,
                            })
                        } else if (roll < 0.66 && next.length > 1) {
                            const a = Math.floor(rand() * next.length)
                            const b = Math.floor(rand() * next.length)
                            const held = next[a] as Item
                            next[a] = next[b] as Item
                            next[b] = held
                        } else if (roll < 0.78 && next.length > 1) {
                            // A REVERSE of a run. The whole-list case is the one that reads right at
                            // both ends and wrong everywhere between, and a sub-run is the same shape
                            // with rows outside it to stay put.
                            const from = Math.floor(rand() * next.length)
                            const to = from + 1 + Math.floor(rand() * (next.length - from))
                            const run = next.slice(from, to).reverse()
                            for (let i = 0; i < run.length; i++) next[from + i] = run[i] as Item
                        } else if (roll < 0.88 && next.length > 1) {
                            // A ROTATION: one row lifted out and put back somewhere else, which
                            // changes every index between the two and trades neither end.
                            const from = Math.floor(rand() * next.length)
                            const [held] = next.splice(from, 1)
                            next.splice(Math.floor(rand() * (next.length + 1)), 0, held as Item)
                        } else if (next.length > 0) {
                            const at = Math.floor(rand() * next.length)
                            next[at] = { id: (next[at] as Item).id, label: `edited ${step}` }
                        }
                    }

                    let mismatches = 0
                    for (let step = 0; step < 200; step++) {
                        const next = rows.peek().slice()
                        // One to four, so a step is sometimes the single mutation the brackets
                        // describe exactly and sometimes several they only bound.
                        const count = 1 + Math.floor(rand() * 4)
                        for (let k = 0; k < count; k++) mutate(next, step)
                        rows.set(next)
                        await tick()
                        const shown = read(host)
                        const wanted = next.map((item) => item.label)
                        if (shown.length !== wanted.length || shown.some((t, i) => t !== wanted[i])) {
                            mismatches++
                        }
                    }
                    // Length as well as order: a walk that dropped a row leaves a shorter list that
                    // still reads right for every index it has.
                    if (read(host).length !== rows.peek().length) mismatches++
                    host.remove()
                    return mismatches
                }

                const single = await fuzz((item) => html`<li>${item.label}</li>`, 1)
                const fragment = await fuzz((item) => html`<li>${item.label}</li><li>·</li>`, 2)
                is('200 random mutations of one-element rows', single, 0)
                is('…and of two-node rows, the same 200', fragment, 0)
            },
        },

        {
            title: 'the DOM-node budget of a list row',
            note: 'One of the three numbers this project budgets emitted code in, and the one a timing hides: a row that quietly grew a wrapper element still renders correctly and still passes every count of text writes. A row is three — the element, its anchor comment, and the text node — against the two a hand-written loop makes. The anchor is what lets a slot own a RANGE rather than a node, and it is the whole of the difference. The vanilla arm reads lower than the two it makes because `textContent =` builds its text node inside the DOM rather than through `createTextNode`, which no counter here can see; the number to compare is the anchor.',
            bench: {
                kind: 'budget',
                arms: [
                    {
                        label: 'abide — 200 rows built from cold',
                        async run() {
                            const rows = state(build(200))
                            const host = document.createElement('ul')
                            fixtures().detached.append(host)
                            const work = await measureFlush(() => {
                                mount(host, () => list(rows))
                            })
                            host.remove()
                            return { count: nodesMade(work), of: 'DOM nodes for 200 rows' }
                        },
                    },
                    {
                        label: 'vanilla — createElement loop over the same 200',
                        async run() {
                            const host = document.createElement('ul')
                            fixtures().detached.append(host)
                            const work = await measureFlush(() => vanilla.buildRows(host, ROWS_200))
                            host.remove()
                            return { count: nodesMade(work), of: 'DOM nodes for 200 rows' }
                        },
                    },
                ],
            },
        },

        {
            title: 'a full reverse of 200 keyed rows',
            note: 'The worst case for the in-order walk, and the one where a hand-written version has no better answer either: reversing really does need a move per row. What it separates is a reconcile from a REBUILD — a rebuild puts 200 creations on the counter next to abide’s zero. What it cannot separate is a minimal-move reconcile from an in-order one, because both move every row; that is the swap above, which is why the swap is the one carrying the keying claim.',
            bench: {
                kind: 'work',
                arms: [
                    {
                        label: 'abide — keyed, in-order placement',
                        prepare: async () => {
                            keyedRows.set(ROWS_200)
                            await tick()
                        },
                        run: () => keyedRows.set(ROWS_200.slice().reverse()),
                    },
                    {
                        label: 'vanilla — append per row',
                        run: () => {
                            const children = Array.from(fixtures().vanillaHost.children).reverse()
                            for (const child of children) fixtures().vanillaHost.append(child)
                        },
                    },
                ],
            },
        },

        {
            title: 'a re-render that changes NOTHING',
            note: 'Every binding compares before it writes. A binding that assigns the value already present produces identical output at full DOM cost — which only a counter can see.',
            bench: {
                kind: 'work',
                arms: [
                    {
                        label: 'abide — same array contents',
                        prepare: async () => {
                            liveRows.set(ROWS_1000)
                            await tick()
                        },
                        run: () => liveRows.set(ROWS_1000.slice()),
                    },
                    {
                        label: 'vanilla — innerHTML with the same markup',
                        run: () => vanilla.buildRowsInnerHTML(fixtures().innerHost, ROWS_1000),
                    },
                    {
                        label: 'vanilla — textContent per row, unguarded',
                        run: () => {
                            const children = fixtures().vanillaBigHost.children
                            for (let i = 0; i < children.length; i++) {
                                ;(children[i] as HTMLElement).textContent = (ROWS_1000[i] as Item).label
                            }
                        },
                    },
                ],
            },
        },

        {
            title: 'attribute bindings that did not move',
            note: 'The same contract on the attribute lane. Five slots re-evaluated, none of them changed.',
            bench: {
                kind: 'work',
                arms: (() => {
                    const level = state('high')
                    // By `prepare`, not here: here is module scope — the suite object is built at
                    // import, and this module is imported on the server too, where there is no
                    // document. Every other fixture in this file went lazy for the same reason.
                    let plain: HTMLElement | null = null
                    const ready = (): void => {
                        if (plain !== null) return
                        const held = fixtures()
                        const host = document.createElement('div')
                        held.detached.append(host)
                        mount(
                            host,
                            () =>
                                html`<p
                                    class=${() => level()}
                                    data-a=${() => level()}
                                    data-b=${() => level()}
                                    data-c=${() => level()}
                                    data-d=${() => level()}
                                ></p>`,
                        )
                        plain = document.createElement('p')
                        held.detached.append(plain)
                    }
                    return [
                        {
                            label: 'abide — five slots, same value',
                            prepare: ready,
                            run: () => level.set('high'),
                        },
                        {
                            label: 'vanilla — setAttribute, unguarded',
                            prepare: ready,
                            run: () => {
                                const node = plain as HTMLElement
                                for (const name of ['class', 'data-a', 'data-b', 'data-c', 'data-d']) {
                                    node.setAttribute(name, 'high')
                                }
                            },
                        },
                    ]
                })(),
            },
        },

        {
            title: 'an unkeyed list edits IN PLACE, which is right until it is a reorder',
            note: 'Without a key a row is identified by its index, so a swap rewrites both rows’ text rather than moving two nodes. That is cheaper for an edit and wrong for a reorder — which is the whole reason `keyed` exists.',
            async run({ is }) {
                const rows = state(build(5))
                const host = container()
                mount(host, () => list(rows))
                const nodes = Array.from(host.querySelectorAll('li'))

                const work = await measureFlush(() => rows.set(swapped(rows.peek(), 1, 3)))
                is(
                    'the screen is right',
                    Array.from(host.querySelectorAll('li')).map((li) => li.textContent),
                    ['row 0', 'row 3', 'row 2', 'row 1', 'row 4'],
                )
                is('but the ELEMENTS never moved', host.querySelectorAll('li')[1], nodes[1])
                is('their text was rewritten instead', work.textWrite, 2)
                is('and nothing was inserted', work.insert, 0)
                host.remove()
            },
        },

        {
            title: 'nested templates patch in place when the call site is the same',
            note: 'Identity of the `strings` array is the test, so a nested template from the same literal updates rather than rebuilding — and a different literal rebuilds, which is what makes a branch swap correct.',
            async run({ is }) {
                const mode = state<'a' | 'b'>('a')
                const value = state(1)
                const host = container()
                const paneA = (n: number): TemplateResult => html`<p class="pane-a">pane A · ${n}</p>`
                const paneB = (n: number): TemplateResult => html`<p class="pane-b">pane B · ${n}</p>`
                mount(
                    host,
                    () => html`<div>${() => (mode() === 'a' ? paneA(value()) : paneB(value()))}</div>`,
                )
                const first = host.querySelector('p')

                const same = await measureFlush(() => value.set(2))
                is('same call site — the element survives', host.querySelector('p'), first)
                is('…and nothing was created', same.createElement, 0)
                is('the text was patched', host.querySelector('p')?.textContent, 'pane A · 2')

                const swap = await measureFlush(() => mode.set('b'))
                is('a different call site rebuilds', host.querySelector('p') === first, false)
                // Cloned, not created: `createElement` fires when a call site is PREPARED, which
                // happens once per process — so pricing the rebuild with it read `1` the first time
                // this case ran and `0` every time after, and the page runs it after `bun test` has.
                is('…which means the pane was CLONED fresh', swap.cloneNode > 0, true)
                is('the new pane', host.querySelector('p')?.className, 'pane-b')
                host.remove()
            },
            interact({ host, log }) {
                const mode = state<'a' | 'b'>('a')
                const value = state(1)
                const out = stage(host)
                const paneA = (n: number): TemplateResult => html`<p class="text-sky-300">pane A · ${n}</p>`
                const paneB = (n: number): TemplateResult => html`<p class="text-amber-300">pane B · ${n}</p>`
                mount(out, () => html`<div>${() => (mode() === 'a' ? paneA(value()) : paneB(value()))}</div>`)
                host.append(
                    row(
                        button('bump the value (same call site)', async () => {
                            const work = await measureFlush(() => value.set(value.peek() + 1))
                            log.live('same call site', nonZero(work))
                        }),
                        button('switch pane (different call site)', async () => {
                            const work = await measureFlush(() => mode.set(mode.peek() === 'a' ? 'b' : 'a'))
                            log.live('different call site', nonZero(work))
                        }),
                    ),
                )
            },
        },

        {
            title: 'a patch REPLACES the previous run’s effects instead of stacking another one',
            note: 'Every thunk slot creates an effect, so a patch that does not first tear down the previous run’s leaves one live effect per patch — each closing over superseded values, all writing to the same binder. The output stays right, because the newest effect runs last and wins, which is exactly why only a WAKE count can see it. Hand-written templates rarely reach this path; a compiled one takes it on every patch.',
            async run({ is }) {
                const value = state(1)
                const patch = state(0)
                let runs = 0
                // Same `strings` on every call, so the nested template PATCHES rather than rebuilds.
                const pane = (n: number): TemplateResult =>
                    html`<p>${() => {
                        runs++
                        return `${n}:${value()}`
                    }}</p>`

                const host = container()
                mount(host, () => html`<div>${() => pane(patch())}</div>`)
                is('one run on mount', runs, 1)

                for (let i = 1; i <= 3; i++) {
                    patch.set(i)
                    await tick()
                }
                is('three patches, three more runs', runs, 4)

                const before = runs
                value.set(2)
                await tick()
                is('ONE effect woke, not one per patch', runs - before, 1)
                is(
                    'and the text is what the newest effect wrote',
                    host.querySelector('p')?.textContent,
                    '3:2',
                )
                host.remove()
            },
            bench: {
                kind: 'wake',
                arms: [
                    {
                        label: 'effects alive after 50 patches of the same call site',
                        async run() {
                            const value = state(1)
                            const patch = state(0)
                            let runs = 0
                            const pane = (n: number): TemplateResult =>
                                html`<p>${() => {
                                    runs++
                                    return `${n}:${value()}`
                                }}</p>`
                            const host = container()
                            mount(host, () => html`<div>${() => pane(patch())}</div>`)
                            for (let i = 1; i <= 50; i++) {
                                patch.set(i)
                                await tick()
                            }
                            const before = runs
                            value.set(2)
                            await tick()
                            host.remove()
                            return { count: runs - before, of: 'wakes on one write' }
                        },
                    },
                ],
            },
        },

        {
            title: 'a row whose values did not MOVE is skipped whole',
            note: 'A list update hands every surviving row a fresh `values` array over identical entries — one changed row of a thousand means 999 arrays that are new objects holding the same things — so `Instance.update` compares by identity before it does anything. The cutoff only works if the entries ARE stable, which is why the compiler emits `${item.id}` rather than `${() => item.id}` for a hole that cannot read: a fresh closure per row is never identical, and the cutoff it defeats is worth more than the thunk it saves. One fresh entry is enough to defeat the whole-row test, and a `@click` handler is one the compiler cannot spell any other way — so the same compare runs again per SLOT, and the row skips every slot that did not move. Nothing about the output can show this — every arm below renders the same list — so the claim is a count of paints.',
            async run({ is }) {
                // A slot value that records being WRITTEN. A row that was skipped never reaches its
                // binder; a row that was walked and found equal does, and only this tells them apart.
                let painted = 0
                const label = (text: string): { toString(): string } => ({
                    toString: () => {
                        painted++
                        return text
                    },
                })
                interface Item {
                    id: string
                    label: { toString(): string }
                }
                const build = (n: number): Item[] => {
                    const out: Item[] = []
                    for (let i = 0; i < n; i++) out.push({ id: `k${i}`, label: label(`row ${i}`) })
                    return out
                }

                const items = state(build(50))
                const host = container()
                mount(
                    host,
                    () => html`<ul>${() => items().map((i) => keyed(i.id, html`<li>${i.label}</li>`))}</ul>`,
                )
                await tick()
                is('50 rows, 50 paints on mount', painted, 50)

                painted = 0
                const next = items.peek().slice()
                next[10] = { id: 'k10', label: label('row 10 — edited') }
                items.set(next)
                await tick()
                is('one row changed, ONE row painted', painted, 1)
                is(
                    '…and it is the one that changed',
                    host.querySelectorAll('li')[10]?.textContent,
                    'row 10 — edited',
                )

                // The same list, one hole per row behind a thunk — what the compiler used to emit.
                // A thunk is a fresh closure on every reconcile, so no row can ever be skipped.
                painted = 0
                const thunked = state(build(50))
                const other = container()
                mount(
                    other,
                    () =>
                        html`<ul>${() => thunked().map((i) => keyed(i.id, html`<li>${() => i.label}</li>`))}</ul>`,
                )
                await tick()
                painted = 0
                const moved = thunked.peek().slice()
                moved[10] = { id: 'k10', label: label('row 10 — edited') }
                thunked.set(moved)
                await tick()
                is('behind a thunk, every row paints', painted, 50)
                is(
                    '…for the same one-row change',
                    other.querySelectorAll('li')[10]?.textContent,
                    'row 10 — edited',
                )

                // A handler is a fresh closure per pass too, but it is not a hole the compiler can
                // spell any other way — so the ARRAY test cannot hold for a row that carries one,
                // and the compare has to be per SLOT to save the row's other slots. Nothing here is
                // reactive but the list itself, so a repaint of row 3 is work nobody asked for.
                painted = 0
                const handled = state(build(50))
                const third = container()
                mount(
                    third,
                    () =>
                        html`<ul>${() =>
                            handled().map((i) =>
                                keyed(i.id, html`<li @click=${() => void i.id}>${i.label}</li>`),
                            )}</ul>`,
                )
                await tick()
                painted = 0
                const edited = handled.peek().slice()
                edited[10] = { id: 'k10', label: label('row 10 — edited') }
                handled.set(edited)
                await tick()
                is('a handler on every row still paints ONE row', painted, 1)
                is(
                    '…and it is the one that changed',
                    third.querySelectorAll('li')[10]?.textContent,
                    'row 10 — edited',
                )

                host.remove()
                other.remove()
                third.remove()
            },
            bench: {
                kind: 'wake',
                arms: (() => {
                    const ROWS = 200
                    interface Item {
                        id: string
                        label: { toString(): string }
                    }
                    // One arm per SHAPE of hole, over the same list and the same one-row edit. A full
                    // rebuild would score both the same; a one-row edit is what separates them.
                    const arm = (thunk: boolean) => async (): Promise<{ count: number; of: string }> => {
                        let painted = 0
                        const label = (text: string): { toString(): string } => ({
                            toString: () => {
                                painted++
                                return text
                            },
                        })
                        const build = (): Item[] => {
                            const out: Item[] = []
                            for (let i = 0; i < ROWS; i++) out.push({ id: `k${i}`, label: label(`row ${i}`) })
                            return out
                        }
                        const items = state(build())
                        const host = container()
                        mount(host, () =>
                            thunk
                                ? html`<ul>${() => items().map((i) => keyed(i.id, html`<li>${() => i.label}</li>`))}</ul>`
                                : html`<ul>${() => items().map((i) => keyed(i.id, html`<li>${i.label}</li>`))}</ul>`,
                        )
                        await tick()
                        painted = 0
                        const next = items.peek().slice()
                        next[100] = { id: 'k100', label: label('edited') }
                        items.set(next)
                        await tick()
                        host.remove()
                        return { count: painted, of: `rows painted for a 1-row edit of ${ROWS}` }
                    }
                    return [
                        { label: 'abide — a hole that cannot read, emitted bare', run: arm(false) },
                        { label: 'the same hole behind a thunk', run: arm(true) },
                    ]
                })(),
            },
        },

        {
            title: 'a REACTIVE slot on every row wakes on every row, whatever moved',
            note: 'The case above skips a row whose values did not move, and per SLOT the row that carries a handler. Neither cutoff can hold for a slot whose value is a THUNK, because a thunk is a fresh closure on every describe and the only thing an identity test can say about it is that it is new. So a list of 1000 rows with one reactive attribute apiece re-runs all 1000 of them for any list update at all — 100 changed labels, or a two-row swap. The DOM is protected: every binding compares before it writes, so the attribute writes stay at 0. The WAKE is not, and it is the thing no output and no DOM counter can show. Two costs are being separated here and only one of them is a defect: waking 1000 rows because 1000 rows read the cell that changed is what every fine-grained framework does and is the shape of the app, not the framework. Waking 1000 rows because the LIST was re-described is the one worth removing — nothing those thunks read had moved.',
            async run({ is, log }) {
                const SIZE = 200
                const rows = state(build(SIZE))
                const selected = state(-1)
                let ran = 0
                const host = container()
                // The compiler's own emit for a row with a conditional class — see the complex page
                // in `packages/perf`, which is where these three ops come from.
                mount(
                    host,
                    () =>
                        html`<ul>${() =>
                            rows().map((item) =>
                                keyed(
                                    item.id,
                                    html`<li class=${() => {
                                        ran++
                                        return item.id === selected() ? 'on' : ''
                                    }}>${item.label}</li>`,
                                ),
                            )}</ul>`,
                )
                await tick()

                let before = ran
                const selecting = await measureFlush(() => selected.set(SIZE / 2))
                const onSelect = ran - before
                is('selecting one row writes ONE attribute', selecting.setAttribute, 1)
                is('…and wakes every row that reads the cell', onSelect, SIZE)

                before = ran
                const editing = await measureFlush(() => {
                    const next = rows.peek().slice()
                    for (let i = 0; i < next.length; i += 10) {
                        next[i] = { id: (next[i] as Item).id, label: `${(next[i] as Item).label} !!!` }
                    }
                    rows.set(next)
                })
                const onEdit = ran - before
                // The contract that IS kept, and the reason this is invisible without a wake count.
                is('editing a tenth of the labels writes no attribute at all', editing.setAttribute, 0)
                is('…and writes exactly the changed labels', editing.textWrite, SIZE / 10)
                is('but every row woke anyway', onEdit, SIZE)

                before = ran
                const swapping = await measureFlush(() => rows.set(swapped(rows.peek(), 1, SIZE - 2)))
                const onSwap = ran - before
                is('a swap moves two rows', swapping.insert, 2)
                is('…and wakes all of them', onSwap, SIZE)

                log(
                    `wakes per DOM write, ${SIZE} rows`,
                    `select ${onSelect}/1 · edit a tenth ${onEdit}/${SIZE / 10} · swap ${onSwap}/2`,
                )
                host.remove()
            },
        },

        {
            title: 'a token into the tail message describes one message, or every message',
            note: 'The case above edits many rows at once; this one edits ONE row, sixty times a second, with two hundred still rows above it — the shape a token stream has and the one every other list case here amortises away. The two arms differ only in how the app spells "the tail got longer", and the DOM cannot tell them apart: both write exactly one text node, insert nothing and create nothing, so no counter above this line and no assertion about what is on screen can separate them. What separates them is that setting a fresh ARRAY asks for the whole list to be described again before any reconciling starts — two hundred `html` tags and two hundred keyed wrappers allocated per token, for one text write — while a tail message that owns its own text cell is a subscription of its own and the list slot never re-runs. At sixty tokens a second the first spelling describes twelve thousand messages a second to change one of them.',
            async run({ is, log }) {
                const ownHost = container()
                const rebuiltHost = container()
                const owning = chatOwningTail(ownHost, CHAT_DEPTH)
                const rebuilding = chatRebuildingArray(rebuiltHost, CHAT_DEPTH)
                await tick()

                const ownedBefore = owning.describes
                const owned = await measureFlush(() => owning.setTail('message 199 tok'))
                const ownedDescribes = owning.describes - ownedBefore

                const rebuiltBefore = rebuilding.describes
                const rebuilt = await measureFlush(() => rebuilding.setTail('message 199 tok'))
                const rebuiltDescribes = rebuilding.describes - rebuiltBefore

                // Everything a test that was not counting describes could have looked at.
                is('a token writes one text node', owned.textWrite, 1)
                is('…and the naive spelling writes the same one', rebuilt.textWrite, 1)
                is('neither inserts a node', owned.insert + rebuilt.insert, 0)
                is('neither creates one', nodesMade(owned) + nodesMade(rebuilt), 0)
                is('and both transcripts read the same', tailOnScreen(ownHost), tailOnScreen(rebuiltHost))

                // What actually separates them.
                is('a tail that owns its text describes nothing', ownedDescribes, 0)
                is('rebuilding the array describes every message', rebuiltDescribes, CHAT_DEPTH)

                log(
                    `per token, ${CHAT_DEPTH} messages deep`,
                    `owned tail ${ownedDescribes} describes · rebuilt array ${rebuiltDescribes}`,
                )
                owning.dispose()
                rebuilding.dispose()
                ownHost.remove()
                rebuiltHost.remove()
            },
            bench: {
                kind: 'wake',
                arms: [
                    {
                        label: 'abide — the tail message owns its text',
                        async run() {
                            const arm = chats().owning
                            const before = arm.describes
                            for (let i = 0; i < 60; i++) {
                                arm.setTail(`message 199 ${i}`)
                                await settled()
                            }
                            return {
                                count: arm.describes - before,
                                of: `message describes for 60 tokens, ${CHAT_DEPTH} deep`,
                            }
                        },
                    },
                    {
                        label: 'abide — the array rebuilt per token',
                        async run() {
                            const arm = chats().rebuilding
                            const before = arm.describes
                            for (let i = 0; i < 60; i++) {
                                arm.setTail(`message 199 ${i}`)
                                await settled()
                            }
                            return {
                                count: arm.describes - before,
                                of: `message describes for 60 tokens, ${CHAT_DEPTH} deep`,
                            }
                        },
                    },
                ],
            },
        },

        {
            title: 'what one token costs',
            note: 'The fixed cost of a single update, which every other bench in this suite divides by a thousand rows and therefore cannot show. A token is one write, one flush and one text node, sixty times a second, with nothing to amortise the framework over — so this is the one arm where the scheduling, the queue and the microtask drain are the whole of what abide adds. The hand-written arm keeps a reference to the text node, because an author writing a chat by hand knows which node the tokens go into; that knowledge is exactly what a framework has to recover, and it is what the ratio is against. All three arms SET a bounded string rather than appending to a growing one — a timed arm runs tens of thousands of times, and a tail that really accumulated would make every arm a measurement of string concatenation. What accumulation costs has its own cases, in `state` and `channel`.',
            async run({ is }) {
                // The three arms have to leave the same thing on screen, or the ratio is between two
                // different jobs. Asserted here rather than assumed, because the bench below is the
                // only other place these arms run and a bench asserts nothing.
                const host = container()
                const owning = chatOwningTail(host, CHAT_DEPTH)
                const byHandHost = container()
                const byHand = vanilla.buildChat(byHandHost, CHAT_DEPTH)
                await tick()

                owning.setTail('message 199 tok')
                vanilla.setTail(byHand, 'message 199 tok')
                await tick()

                is('abide and the hand-written arm agree', tailOnScreen(host), tailOnScreen(byHandHost))
                is('…on the text the tokens produced', tailOnScreen(host), 'message 199 tok')

                const work = await measureFlush(() => owning.setTail('message 199 tok tok'))
                is('and a token is one text write with nothing else', total(work), 1)

                owning.dispose()
                host.remove()
                byHandHost.remove()
            },
            bench: {
                kind: 'time',
                floor: 'flush',
                arms: [
                    {
                        label: 'abide — the tail message owns its text',
                        run: async (i: number) => {
                            chats().owning.setTail(`message 199 ${i}`)
                            await settled()
                        },
                    },
                    {
                        label: 'abide — the array rebuilt per token',
                        run: async (i: number) => {
                            chats().rebuilding.setTail(`message 199 ${i}`)
                            await settled()
                        },
                    },
                    {
                        label: 'vanilla — the tail text node, held and written',
                        run: (i: number) => vanilla.setTail(chats().byHand, `message 199 ${i}`),
                    },
                ],
            },
        },

        {
            title: 'a pass that threw is not a pass that was APPLIED',
            note: 'Skipping a slot whose value did not move is only sound against a pass that finished. A binder can throw out of the middle of the loop — a slot reading a cell whose load rejected throws by design, and so do a `{#try}` body with no `{:catch}` and an author’s `&ref` handler — and every slot after it was never applied. Comparing against what was HANDED OVER rather than what LANDED would skip those for as long as their values stay put: a value stuck on screen forever, with no error left to show for it. The instance keeps both, and only the finished pass is what a skip is judged against.',
            async run({ is }) {
                // Throwing on the way to text is a binder throwing — here at slot 0 of three, on the
                // second pass only. `flush` rethrows it from a fresh microtask, so the error printed
                // alongside this case is the framework keeping the throw observable, not a failure.
                const n = state(1)
                const bomb = (k: number): { toString(): string } => ({
                    toString: () => {
                        if (k === 2) throw new Error('a binder that throws mid-pass')
                        return `v${k}`
                    },
                })
                const host = container()
                mount(host, () => {
                    const k = n()
                    return html`<b>${bomb(k)}</b><i>${k === 1 ? 'one' : 'two'}</i><u>${k}</u>`
                })
                is('the first pass lands whole', host.querySelector('i')?.textContent, 'one')

                n.set(2)
                await tick()
                is(
                    'the pass that threw stopped at the slot that threw',
                    host.querySelector('i')?.textContent,
                    'one',
                )

                // The third pass hands slot 1 the SAME `'two'` the half-pass was handed. Judged
                // against what was handed over, it is unchanged and gets skipped — and `one` is then
                // what the page shows for the rest of its life.
                n.set(3)
                await tick()
                is('the slot that threw is retried', host.querySelector('b')?.textContent, 'v3')
                is('…and so is the one it skipped past', host.querySelector('i')?.textContent, 'two')
                is('…alongside the one that actually moved', host.querySelector('u')?.textContent, '3')
                host.remove()
            },
        },

        {
            title: 'a template whose ROOT is a slot paints on the first render',
            note: 'A top-level child slot inserts what it renders before its anchor comment, which is still inside the fragment while the instance is being built. Recording the instance’s nodes before that first update captured only the anchor — so the content was left orphaned in the fragment and the template painted BLANK until some later update happened to re-place it.',
            async run({ is }) {
                const items = state(['a', 'b'])
                const host = container()
                mount(host, () => html`${() => items().map((x) => html`<li>${x}</li>`)}`)
                is(
                    'a list at the root',
                    Array.from(host.querySelectorAll('li')).map((li) => li.textContent),
                    ['a', 'b'],
                )

                const label = state('hello')
                const text = container()
                mount(text, () => html`${() => label()}`)
                is('a bare text slot at the root', text.textContent, 'hello')
                host.remove()
                text.remove()
            },
        },

        {
            title: 'an async cell paints when it lands, with the ordinary read',
            note: 'No `<Suspense>` and no second spelling: the slot reads the cell, and the cell wakes it once the load settles.',
            async run({ is }) {
                const session = state(Promise.resolve('ada'))
                const host = container()
                mount(host, () => html`<p>${() => (session.pending() ? '…' : session())}</p>`)
                is('while it is cold', host.querySelector('p')?.textContent, '…')
                await tick()
                is('once it lands', host.querySelector('p')?.textContent, 'ada')
                host.remove()
            },
            interact({ host, log }) {
                const results = state<string[] | undefined>(undefined)
                const out = stage(host)
                mount(
                    out,
                    () =>
                        html`<p class="text-slate-100">
                            ${() => (results() === undefined ? 'loading…' : (results() as string[]).join(', '))}
                        </p>`,
                )
                let generation = 0
                host.append(
                    field('search', (text) => {
                        const mine = ++generation
                        results.set(undefined)
                        void sleep(300).then(() => {
                            if (mine !== generation) return
                            results.set(['alpha', 'beta', 'gamma'].filter((word) => word.includes(text)))
                        })
                    }),
                )
                log('', 'a promise placed directly in the slot behaves the same way — see the html page')
            },
        },

        {
            title: 'a promise superseded before it lands never paints over the newer one',
            note: 'Each child part stamps what it is showing, so a settle that arrives after it has been replaced — or after the tree was disposed — is discarded.',
            async run({ is }) {
                const query = state('a')
                const gate: ((value: string) => void)[] = []
                const host = container()
                mount(
                    host,
                    () =>
                        html`<p>${() => {
                            query()
                            return new Promise<string>((resolve) => gate.push(resolve))
                        }}</p>`,
                )
                query.set('b')
                await tick()
                is('two loads are in flight', gate.length, 2)
                gate[1]?.('second')
                await tick()
                gate[0]?.('first') // the stale load lands last
                await tick()
                is('the newer answer survives', host.querySelector('p')?.textContent, 'second')
                host.remove()
            },
            interact({ host, log }) {
                const seed = state(0)
                const out = stage(host)
                const shown = (): string => out.querySelector('p')?.textContent?.trim() ?? ''
                mount(
                    out,
                    () =>
                        html`<p class="text-slate-100">
                            ${() => {
                                const current = seed()
                                // Odd seeds are slow, even ones fast — so a click is a fresh round
                                // rather than a replay that ends on the text already on screen.
                                const slow = current % 2 === 1
                                return sleep(slow ? 600 : 60).then(() => {
                                    // What the claim is about is the paint that does NOT happen, so
                                    // the log reports what the pane reads after each settle. A
                                    // macrotask, because the binder paints from this same chain.
                                    setTimeout(() =>
                                        log(
                                            `seed ${current} settled (${slow ? 600 : 60}ms)`,
                                            `the pane reads “${shown()}”`,
                                        ),
                                    )
                                    return `settled: seed ${current}`
                                })
                            }}
                        </p>`,
                )
                let round = 0
                host.append(
                    row(
                        button('a slow load, then a fast one', () => {
                            round++
                            seed.set(round * 2 - 1)
                            setTimeout(() => seed.set(round * 2), 20)
                        }),
                    ),
                )
            },
        },

        {
            title: 'a cell handed back by a thunk is READ, not rendered as a function',
            note: 'No trailing `()`. A handle in a slot means its value, on both substrates — which is what lets a keyed slot be dropped straight into a template.',
            async run({ is }) {
                const search = memo(async ({ q }: { q: string }) => `results for ${q}`)
                const query = state('a')
                const host = container()
                mount(host, () => html`<p>${() => search({ q: query() })}</p>`)
                is('cold', host.querySelector('p')?.textContent, '')
                await tick()
                is('once it lands', host.querySelector('p')?.textContent, 'results for a')

                query.set('b')
                await tick()
                is(
                    'a new key is a new slot, and the slot paints',
                    host.querySelector('p')?.textContent,
                    'results for b',
                )
                host.remove()
            },
        },

        {
            title: 'tearing down a WRAPPED list costs one removal, whatever its length',
            note: 'A list inside an element goes out of the document by that element. Every row removing itself first is n removals to reach a state one removal already reaches — and it was n, so navigating away from a thousand-row page paid a thousand DOM calls it did not need. The assertion is a ratio between two LENGTHS of the same structure rather than an absolute, because that is the shape that says O(1) rather than “small”: two hundred rows and a thousand must cost the same. Only an implementation that takes the range out before letting the rows tear themselves down can manage it.',
            async run({ is, log }) {
                const teardown = async (n: number): Promise<number> => {
                    const items = build(n)
                    const shown = state(true)
                    const host = container()
                    mount(
                        host,
                        () =>
                            html`<div>${() =>
                                shown()
                                    ? html`<ul>${items.map((item) => keyed(item.id, html`<li>${item.label}</li>`))}</ul>`
                                    : 'gone'}</div>`,
                    )
                    await tick()
                    const work = await measureFlush(() => shown.set(false))
                    host.remove()
                    return work.remove
                }

                const small = await teardown(200)
                const large = await teardown(1000)
                log('removals to tear the list down', `200 rows — ${small}, 1000 rows — ${large}`)
                is('two hundred rows cost one removal', small, 1)
                is('…and five times as many cost the same', large, small)
            },
        },

        {
            title: 'dropping a row costs ONE removal, whatever the row holds inside it',
            note: 'A row goes out of the document by its own top node; everything under it leaves at the same moment, as descendants. Letting each child slot then run its own removal walked an already-detached subtree — 4x the removes of a hand-written `li.remove()` on a 500-of-1000 drop, and not one of them on a connected node. The assertion is a ratio between two ROW SHAPES rather than an absolute: a row with three slots and a row with one must cost the same per drop, and only an implementation that stops at the top node can manage that. This is sound only because a row reports the range it HOLDS rather than the one it was built with — the same shortcut over a captured list left repainted nodes connected, which the two cases below are about.',
            async run({ is, log }) {
                const drop = async (row: (item: Item) => TemplateResult): Promise<number> => {
                    const rows = state(build(20))
                    const host = container()
                    mount(host, () => html`<ul>${() => rows().map((item) => keyed(item.id, row(item)))}</ul>`)
                    await tick()
                    // Ten of twenty, from the middle, so the drop is not also a truncation.
                    const work = await measureFlush(() => rows.set(rows.peek().slice(0, 10)))
                    host.remove()
                    return work.remove
                }

                const thin = await drop((item) => html`<li>${item.label}</li>`)
                const fat = await drop(
                    (item) =>
                        html`<li><span>${item.label}</span><span>${item.id}</span><i>${item.label}</i></li>`,
                )
                log('removals for ten dropped rows', `one slot — ${thin}, three slots — ${fat}`)
                is('a one-slot row costs one removal each', thin, 10)
                is('…and three slots inside cost no more', fat, thin)
            },
        },

        {
            title: 'a keyed row whose ROOT is a fragment reorders by what it holds now',
            note: 'An instance records its top-level nodes once. When the root is a single element that record cannot go stale — the element IS the range and its slots are inside it. When the root is a fragment, a top-level slot paints into the range without the instance hearing about it, so the record describes nodes that have since been replaced: the reorder then moves those and strands the live ones, which read as `h1` and `X1` drifting apart. The range is contiguous, so what fixes it is walking it rather than remembering it. A text slot cannot show this — it rewrites one node and keeps its identity — so the slot here swaps a TEMPLATE in, which is what replaces nodes.',
            async run({ is }) {
                const rows = state([1, 2, 3])
                const swapped = state(false)
                const host = container()
                const view = mount(
                    host,
                    () =>
                        html`<div>${() =>
                            rows().map((n) =>
                                keyed(
                                    n,
                                    html`<b>h${n}</b>${() => (swapped() ? html`<i>X${n}</i>` : `p${n}`)}`,
                                ),
                            )}</div>`,
                )
                await tick()
                is('the first paint', host.textContent, 'h1p1h2p2h3p3')

                // The repaint has to REPLACE nodes, and it has to happen before the reorder — that is
                // the whole shape of it.
                swapped.set(true)
                await tick()
                is('every row repainted', host.textContent, 'h1X1h2X2h3X3')

                rows.set([3, 2, 1])
                await tick()
                is('and the reverse moved what each row HOLDS', host.textContent, 'h3X3h2X2h1X1')
                view.dispose()
                host.remove()
            },
        },

        {
            title: 'a nested template that REPAINTED still leaves nothing behind',
            note: 'An instance captures its top-level nodes once, at construction. A nested template whose root is a fragment has a child slot AMONG those top-level nodes, so anything that slot repaints afterwards sits in the document without being in the captured list — and a teardown that trusts the capture to describe the live range walks past it. Asserted by `isConnected` on the node the repaint made, because the container looks close enough to right either way: the leak is a sibling of the incoming content, not a duplicate of it. This is the shape that makes an ancestor-covers-descendants shortcut in teardown unsound, and it is why one is not taken.',
            async run({ is }) {
                const which = state(0)
                const flag = state(false)
                const host = container()
                const view = mount(
                    host,
                    () =>
                        html`<div>${() =>
                            which() === 0
                                ? html`${() => (flag() ? html`<b>B</b>` : 'plain')}`
                                : 'gone'}</div>`,
                )
                await tick()

                // The repaint has to happen AFTER the nested instance captured its nodes, or the
                // capture would describe the live range and there would be nothing to miss.
                flag.set(true)
                await tick()
                const painted = host.querySelector('b')
                is('the repaint is on screen', painted?.textContent, 'B')

                // Swap the outer slot away, which disposes the nested instance.
                which.set(1)
                await tick()
                is('the swap painted its own content', host.textContent, 'gone')
                is('and the repainted node left with it', painted?.isConnected, false)
                view.dispose()
                host.remove()
            },
        },

        {
            title: 'dispose tears the tree down and stops updates',
            note: '`mount` returns a handle. Everything created under it — every slot effect, every nested part, every list row — disposes together, because they were all created inside one `scope`.',
            async run({ is }) {
                const n = state(1)
                let runs = 0
                const host = container()
                const view = mount(
                    host,
                    () =>
                        html`<p>${() => {
                            runs++
                            return n()
                        }}</p>`,
                )
                is('the first run', runs, 1)

                view.dispose()
                n.set(2)
                await tick()
                is('the slot effect is gone', runs, 1)
                is('and the container is empty', host.childNodes.length, 0)
                host.remove()
            },
            interact({ host, log }) {
                const n = state(0)
                const out = stage(host)
                const mounted = mount(out, () => html`<p class="text-slate-100">n = ${() => n()}</p>`)
                let disposed = false
                host.append(
                    row(
                        button('n.set(n + 1)', async () => {
                            const work = await measureFlush(() => n.set(n.peek() + 1))
                            log.live('work per write', `${nonZero(work)}${disposed ? ' — disposed' : ''}`)
                        }),
                        button('dispose()', () => {
                            mounted.dispose()
                            disposed = true
                            log('disposed', 'the container is empty and further writes reach nothing')
                        }),
                    ),
                )
            },
        },

        {
            title: 'parse once per call site',
            note: 'One call site is parsed once no matter how many rows come out of it, and every later row is a clone plus a walk. The number is a RATIO against the createElement loop beside it — the same rows, the same box, the same clock — because a bare millisecond off a browser clock describes this machine. Both lists are visible and both scroll, so neither arm is dodging layout the other pays. The clock is clamped to about a millisecond, which is why the smallest button is 100 rows and not one.',
            interact({ host, log }) {
                const out = stage(host, 'abide — one call site (scroll)')
                out.className += ' max-h-40 overflow-auto'
                const rows = state<Item[]>([])
                mount(out, () => list(rows))

                const arm = stage(host, 'vanilla — createElement per row (scroll)')
                arm.className += ' max-h-40 overflow-auto'
                const byHand = document.createElement('ul')
                byHand.className = 'font-mono text-xs'
                arm.append(byHand)

                const time = async (n: number): Promise<void> => {
                    const items = build(n)
                    rows.set([])
                    byHand.replaceChildren()
                    await tick()
                    const startedAbide = performance.now()
                    rows.set(items)
                    await tick()
                    const abide = performance.now() - startedAbide
                    const startedByHand = performance.now()
                    vanilla.buildRows(byHand, items)
                    const hand = performance.now() - startedByHand
                    log(`${n} rows`, `${(abide / hand).toFixed(2)}× the createElement loop`)
                }
                host.append(
                    row(
                        button('100 rows', () => void time(100)),
                        button('1000 rows', () => void time(1000)),
                        button('5000 rows', () => void time(5000)),
                    ),
                )
            },
        },
        {
            title: 'a settled block is not re-entered when a SIBLING slot wakes',
            note: 'The claim every other case here makes about DOM work, made about WAKES instead — and the one this suite could not previously see. Each slot gets its own effect, so writing a cell one slot reads must not re-run the thunk of the slot beside it. When it does the output is still right, which is why only a counter catches it: an `{#await}` whose thunk re-runs evaluates its operand again, hands the part a promise it has not seen, and the `holding` cutoff correctly treats a new operand as a new load — so a settled panel flashes back to its pending arm and fetches a second time. That is the failure a bare block head reintroduced, and this is what would have failed instead of 417 green tests.',
            async run({ is }) {
                let loads = 0
                const load = (): Promise<string> => {
                    loads++
                    return Promise.resolve(`load ${loads}`)
                }
                const beside = state(0)
                const host = container()
                mount(
                    host,
                    () =>
                        html`<p>${() => beside()}</p><b>${() => awaited(load(), { pending: () => html`pending`, then: (value) => html`${value}`, catch: undefined, finally: undefined })}</b>`,
                )
                await until(() => host.querySelector('b')?.textContent === 'load 1', 'the panel to settle')
                is('one load to settle it', loads, 1)

                // The write the sibling reads. Nothing the block evaluates has changed.
                beside.set(1)
                await tick()
                is('the sibling repainted', host.querySelector('p')?.textContent, '1')
                // The counter is what catches it. By this point a re-entered block reads `load 2`
                // rather than `pending`, so the text alone would only say the panel is wrong — not
                // that it reloaded, which is the claim.
                is('…and the block did NOT reload', loads, 1)
                is('…and still shows what it settled to', host.querySelector('b')?.textContent, 'load 1')
                host.remove()
            },
        },
    ],
})
