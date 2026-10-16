// WHAT A DOCS CARD CLAIMS, ASSERTED AGAINST THE HAND-WRITTEN ARM BESIDE IT. Every arm under
// `arms/` is the other half of a ratio `bench:compiler` reports, and a ratio against an arm that
// does not do the work is a figure rather than a claim — so each arm has to HOLD the invariant its
// card's prose states: a hand-written dependency list, a hand-written entry table.
//
// The card itself runs the `.abide` component in the docs app; this pins the arm it is priced
// against.
//
// THIS FILE holds what is checked across EVERY arm at once; the specs over one arm each are in
// the `arms*.test.ts` files beside it, split by the docs they stand behind.
import { expect, test } from 'bun:test'
import {
    abideSourcesOf,
    DOGFOOD,
    exampleComponentOf,
} from '../scripts/exampleSources.ts'
import { ARMS_DIR } from './armDrivers.ts'

// THE ARM AND THE `.abide` SOURCE ARE CLAIMED TO BE EQUIVALENT, which is what makes a ratio
// between them a claim. This closes the checkable corner of it: a CONTROL is markup an author
// wrote, so a button the arm renders that the example's own source never names is the two arms
// having come apart, and it renders perfectly either way.
//
// Data is legitimately absent from source, coming from a database the example stubs, so only
// controls are compared — and against the TEXT NODES of the templates, never whole source:
// matching a label against a whole file lets any coincidence rescue it, and `Post` on a button
// was once covered by `type Post` in a sibling `.ts` with the button renamed.
test('every control the arm renders is one the page source names', async () => {
    const strays: string[] = []
    for (const path of new Bun.Glob('*/index.html').scanSync({
        cwd: ARMS_DIR.pathname,
    })) {
        const name = path.slice(0, path.indexOf('/'))
        let markup = ''
        for (const file of await abideSourcesOf(name)) {
            const template = await Bun.file(new URL(file, DOGFOOD)).text()
            markup += template.replaceAll(/<[^>]*>/g, '\n')
        }
        const arm = await Bun.file(new URL(path, ARMS_DIR)).text()
        for (const control of arm.matchAll(/<(?:button|a)\b[^>]*>([^<]+)</g)) {
            const label = (control[1] ?? '').trim()
            if (!label || markup.includes(label)) continue
            strays.push(`${path}: "${label}"`)
        }
    }
    expect(strays).toEqual([])
})

// THE SIBLING OF THE CONTROL CHECK, pointed at the thing a demo card is FOR. A card claims
// something about work — derivations rerun, requests made, entries held — and the claim is
// only ever visible as a readout, so an arm reporting a count the `.abide` source never names
// is the two arms having come apart on the one line the reader is there to read. It renders
// perfectly either way, and it is worse than a stray button: a stray button does nothing, and
// a stray counter is a figure the ratio is then taken against. RULEBOOK 40.19.
//
// A READOUT IS A `<strong>` and its label is the text in front of it, which is the shape both
// arms already wrote — the value is the part that legitimately differs, being live in one and
// an id in the other, so only the label is compared.
//
// WHITESPACE-COLLAPSED, because HTML collapses it: the `.abide` file wraps at the 76-column
// rule the panel renders in and the arm does not, so a label reading identically on screen was
// two strings apart. Comparing the source text would have made the gate a line-wrap check.
const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

// TWO SHAPES, because a card has two kinds of readout: a stat TILE, where the label is the
// `<span>` that opens the item, and an INLINE one, where it is the run of text in front of the
// value. Both are compared; a label that lived only in the arm is the drift this is here for.
//
// A TILE IS MATCHED PER ITEM rather than by what sits between the label and the value, because
// a CONTROL can sit there: the quantity stepper puts two buttons inside the tile, and a pattern
// wanting the two adjacent went blind on exactly the tile that grew one. Tiles are removed as
// they are read, so the inline pass cannot report a tile's own text a second time.
function labelsIn(markup: string): string[] {
    const labels: string[] = []
    const rest = markup.replace(
        /<li\b[^>]*>([\s\S]*?)<\/li>/g,
        (whole, inner: string) => {
            if (!/<strong\b/.test(inner)) return whole
            labels.push(
                collapse(/<span[^>]*>([^<]*)<\/span>/.exec(inner)?.[1] ?? ''),
            )
            return ''
        },
    )
    for (const inline of rest.matchAll(/>([^<>]+)<strong\b/g)) {
        labels.push(collapse(inline[1] ?? ''))
    }
    return labels
}

test('every readout the arm renders is one the page source names', async () => {
    const strays: string[] = []
    for (const path of new Bun.Glob('*/index.html').scanSync({
        cwd: ARMS_DIR.pathname,
    })) {
        const name = path.slice(0, path.indexOf('/'))
        let markup = ''
        for (const file of await abideSourcesOf(name)) {
            const template = await Bun.file(new URL(file, DOGFOOD)).text()
            markup += template.replaceAll(/<[^>]*>/g, '\n')
        }
        const flat = collapse(markup)
        const arm = await Bun.file(new URL(path, ARMS_DIR)).text()
        for (const label of labelsIn(arm)) {
            if (!label || flat.includes(label)) continue
            strays.push(`${path}: "${label}"`)
        }
    }
    expect(strays).toEqual([])
})

// A SWITCHER IN AN ARM IS `.switch` with one link current, the markup the `.abide` side
// declares — an arm drawing two default links is doing less work than the component it is priced
// against. Both halves regressed separately: one arm carried the current link and not the class,
// another carried the class and never marked a link.
test('a switcher in an arm is a `.switch` with exactly one link current', async () => {
    const wrong: string[] = []
    for (const path of new Bun.Glob('*/index.html').scanSync({
        cwd: ARMS_DIR.pathname,
    })) {
        const arm = await Bun.file(new URL(path, ARMS_DIR)).text()
        for (const nav of arm.matchAll(/<nav\b([^>]*)>(.*?)<\/nav>/gs)) {
            const attributes = nav[1] ?? ''
            const body = nav[2] ?? ''
            if (!/\bclass="[^"]*\bswitch\b[^"]*"/.test(attributes))
                wrong.push(`${path}: nav is not a .switch`)
            const current = body.match(/aria-current=/g)?.length ?? 0
            if (current !== 1)
                wrong.push(`${path}: ${current} links are current, not 1`)
        }
    }
    expect(wrong).toEqual([])
})

// 40.40 — AN ARM IS PAIRED WITH A DOCS EXAMPLE, or it is a figure with nothing to be a ratio of: an
// arm the harness wrote for itself is the one written beside the implementation it flatters.
test('every arm is paired with a docs example', async () => {
    const unpaired: string[] = []
    for (const path of new Bun.Glob('*/index.html').scanSync({
        cwd: ARMS_DIR.pathname,
    })) {
        const name = path.slice(0, path.indexOf('/'))
        if ((await exampleComponentOf(name)) === undefined) unpaired.push(name)
    }
    expect(unpaired).toEqual([])
})
