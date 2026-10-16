// The pages both render benches build, so the server timing and the browser timing are over the
// SAME source. A card list, scaled by how many cards — the shape an app actually renders, and one
// where the per-card cost is what a reader waits on.

export type Card = { id: number; title: string; body: string; count: number }

/** `n` cards with ids `0` to `n - 1`. */
export function cards(n: number): Card[] {
    const out: Card[] = []
    for (let at = 0; at < n; at += 1)
        out.push({
            id: at,
            title: `Card ${at}`,
            body: `Body text for card number ${at}`,
            count: at % 7,
        })
    return out
}

/**
 * The hand-written arm's client script: finds the nodes an update will write, into `__WIRED__`.
 *
 * The hand-written arm's CLIENT half: find the nodes a later update will write. That is what a
 * person does by hand, and it is what `mount` does — abide additionally opens a reactive
 * subscription per run, which is capability rather than waste and is named in the bench output
 * rather than hidden in the ratio.
 */
export function vanillaWire(): string {
    return `
const nodes = []
const articles = document.querySelectorAll('#list > article')
for (let at = 0; at < articles.length; at += 1) {
    const card = articles[at]
    nodes.push(card.children[0].firstChild, card.children[1].firstChild, card.children[2].firstChild)
}
globalThis.__WIRED__ = nodes
`
}

/**
 * One card's `<article>` markup, with the three values spliced in as given.
 *
 * THE CARD ROW, ONCE. Three `.abide` arms write this row — a `{#for}`, the unrolled page and the
 * component — and the whole premise of the render and component benches is that they differ in
 * nothing but how the three values reach the slots. Interpolating one template is what makes that
 * true by construction; four hand-kept literals is what made it a comment.
 *
 * `vanillaMarkup` DOES NOT CALL THIS, and the reason is the clock: it builds a row per card INSIDE
 * a `batch()` arm, so a call frame per row would be a change to the baseline every ratio in both
 * benches is against. Its literal is kept beside this one deliberately.
 */
function cardRow(title: string, body: string, count: string): string {
    return `<article class="card"><h2>${title}</h2><p>${body}</p><span class="n">${count}</span></article>`
}

/**
 * The card-list page's `.abide` source written with `{#for}`, its data left as `CARDS`.
 *
 * How anybody would write it. The unrolled one below is kept beside it because the difference
 * between them is a finding: straight-line emitted code never gets warm, and a loop is what fixes
 * it.
 */
export function abideLoopSource(): string {
    return `<script>
import { reactive } from '@abide/abide'

let rows = reactive(CARDS)
</script>
<main id="list">{#for row of rows by row.id}${cardRow('{row.title}', '{row.body}', '{row.count}')}{/for}</main>`
}

/**
 * The card-list page's `.abide` source for `n` cards, unrolled, its data left as `CARDS`.
 *
 * Written out rather than looped: the loop is unrolled at generation time, one straight-line row
 * per card, which is the shape `abideLoopSource` is measured against.
 */
export function abideSource(n: number): string {
    let template = ''
    for (let at = 0; at < n; at += 1)
        template += cardRow(
            `{rows[${at}].title}`,
            `{rows[${at}].body}`,
            `{rows[${at}].count}`,
        )
    return `<script>
import { reactive } from '@abide/abide'

let rows = reactive(CARDS)
</script>
<main id="list">${template}</main>`
}

/**
 * The hand-written arm's card-list markup, escaped the way a person escapes by hand.
 *
 * The page somebody writes when nothing compiles for them.
 *
 * IT ESCAPES, and it has to. The first version of this interpolated the values raw and was 3.2x
 * faster than the compiled page — because it was not doing the same work. A hand-written page
 * that puts data it did not author into markup has an injection or it has an escape; the compiled
 * page has 32.1 and cannot choose. SHARED SOURCE IS NOT SHARED WORK, and an arm that skips the
 * safety is the same mistake as an arm that renders nothing.
 */
export function vanillaMarkup(list: Card[]): string {
    let out = '<main id="list">'
    for (const card of list)
        out += `<article class="card"><h2>${escapeByHand(card.title)}</h2><p>${escapeByHand(card.body)}</p><span class="n">${escapeByHand(String(card.count))}</span></article>`
    return `${out}</main>`
}

/**
 * The hand-written card list again, escaped by a person who tests before rewriting.
 *
 * THE CAREFUL ARM, beside the obvious one. `vanillaMarkup`'s chain allocates three strings per
 * value whether or not anything needed escaping, and `escapeText` scans and hands the input back
 * untouched — so a win against the obvious arm alone could be the escaping and nothing else. This
 * arm skips the rewrite the same way, and what is left between it and abide is the rest of the
 * page.
 */
export function vanillaCarefulMarkup(list: Card[]): string {
    let out = '<main id="list">'
    for (const card of list)
        out += `<article class="card"><h2>${escapeCarefully(card.title)}</h2><p>${escapeCarefully(card.body)}</p><span class="n">${escapeCarefully(String(card.count))}</span></article>`
    return `${out}</main>`
}

/** What a person writes when they escape by hand, which is a `replace` chain rather than a scan. */
function escapeByHand(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
}

// The three characters `escapeText` rewrites in a text slot, and no more.
const NEEDS_ESCAPING = /[&<>]/

/** The same chain, behind the test a careful person puts in front of it. */
function escapeCarefully(value: string): string {
    return NEEDS_ESCAPING.test(value) ? escapeByHand(value) : value
}

/**
 * The card row as a `Card` component's `.abide` source, its three values taken as props.
 *
 * THE SAME CARD, AS A COMPONENT — the same `cardRow`, so the only difference between this arm and
 * `abideLoopSource` is the invocation: a call, an anchor pair, and one accessor per prop. What
 * that costs a row is the whole question 32.17 and 33 owe an answer to.
 */
export function abideCardSource(): string {
    return `<script>
import { props } from '@abide/abide'

const { title, body, count } = props<{ title: string; body: string; count: number }>()
</script>
${cardRow('{title}', '{body}', '{count}')}`
}

/**
 * The `{#for}` page with an inline component declared in each row, its data left as `CARDS`.
 *
 * 32.42 — the component closes over the row. `invoked` renders the row through it; without, the row
 * is `abideLoopSource`'s and the component is declared and never invoked — the declaration alone.
 */
export function abideDeclaredSource(invoked: boolean): string {
    const card = cardRow('{row.title}', '{row.body}', '{row.count}')
    return `<script>
import { reactive } from '@abide/abide'

let rows = reactive(CARDS)
</script>
<main id="list">{#for row of rows by row.id}{#component Card()}${card}{/component}${invoked ? '<Card/>' : card}{/for}</main>`
}

/** The card-list page with each row a `<Card>` invocation, its data left as `CARDS`. */
export function abideComponentSource(): string {
    return `<script>
import { reactive } from '@abide/abide'
import Card from './Card.abide'

let rows = reactive(CARDS)
</script>
<main id="list">{#for row of rows by row.id}<Card title={row.title} body={row.body} count={row.count}/>{/for}</main>`
}
