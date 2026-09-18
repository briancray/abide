// The pages both render benches build, so the server timing and the browser timing are over the
// SAME source. A card list, scaled by how many cards — the shape an app actually renders, and one
// where the per-card cost is what a reader waits on.

export type Card = { id: number; title: string; body: string; count: number }

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

// The `.abide` source for a page holding `n` cards, written out rather than looped: `{#for}` is
// not built, so the loop is unrolled at generation time. What is being timed is the emitted
// code's shape, and an unrolled page has exactly the shape a `{#for}` will emit per row.
// The hand-written arm's CLIENT half: find the nodes a later update will write, and wire the
// button. That is what a person does by hand, and it is what `mount` does — abide additionally
// opens a reactive subscription per run, which is capability rather than waste and is named in
// the bench output rather than hidden in the ratio.
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

export function abideSource(n: number): string {
    let template = ''
    for (let at = 0; at < n; at += 1)
        template += `<article class="card"><h2>{rows[${at}].title}</h2><p>{rows[${at}].body}</p><span class="n">{rows[${at}].count}</span></article>`
    return `<script>
import { reactive } from 'abide'

let rows = reactive(CARDS)
</script>
<main id="list">${template}</main>`
}

// The hand-written arm: the page somebody writes when nothing compiles for them.
//
// IT ESCAPES, and it has to. The first version of this interpolated the values raw and was 3.2x
// faster than the compiled page — because it was not doing the same work. A hand-written page
// that puts data it did not author into markup has an injection or it has an escape; the compiled
// page has 32.1 and cannot choose. SHARED SOURCE IS NOT SHARED WORK, and an arm that skips the
// safety is the same mistake as an arm that renders nothing.
export function vanillaMarkup(list: Card[]): string {
    let out = '<main id="list">'
    for (const card of list)
        out += `<article class="card"><h2>${escape(card.title)}</h2><p>${escape(card.body)}</p><span class="n">${escape(String(card.count))}</span></article>`
    return `${out}</main>`
}

// What a person writes when they escape by hand, which is a `replace` chain rather than a scan.
function escape(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
}
