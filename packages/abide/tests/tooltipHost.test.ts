// 50.36, 50.53, 50.54, 50.86, 50.87 — `tooltip.host`'s parts: what its popover carries as the server writes it, and the
// text of the hint showing in the last host standing. Its part is read by hand here; what a template
// does with it is the CRM's tests'.

import { afterEach, expect, test } from 'bun:test'

import { flushSync } from '#shared'
import { pie } from '#shared/chart/pie.ts'
import { collectWatches } from '#shared/reactive/watch.ts'
import { host } from '#shared/tooltip/host.ts'
import { tip } from '#shared/tooltip/tip.ts'

import { bindPart } from './bindPart.ts'

afterEach(() => document.body.replaceChildren())

// A host standing as a component's setup stands it: its watches collected, and stopped as it leaves.
function standing() {
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    const parts = host()
    collectWatches(previous)
    return {
        parts,
        leave: () => {
            for (const stop of stops) stop()
        },
    }
}

async function opened(text: string): Promise<() => void> {
    const anchor = document.body.appendChild(document.createElement('button'))
    const unbind = bindPart(tip(text, { delay: 0 }), anchor)
    anchor.dispatchEvent(
        new PointerEvent('pointerenter', { pointerType: 'mouse' }),
    )
    await Bun.sleep(1)
    flushSync()
    return unbind
}

test('the hint part is a closed manual tooltip popover as written — 50.53', () => {
    const shown = standing()
    expect(shown.parts.hint.role).toBe('tooltip')
    expect(shown.parts.hint.popover).toBe('manual')
    expect(shown.parts.hint['data-open']).toBeUndefined()
    expect(shown.parts.text).toBeUndefined()
    shown.leave()
})

// THE REVERT: have `text` read the hint showing whatever host stands, and the first host writes it too.
test('the hint shows in the last host standing alone, until it closes — 50.36, 50.54', async () => {
    const first = standing()
    const last = standing()
    const unbind = await opened('Signed.')
    expect(last.parts.text).toBe('Signed.')
    expect(last.parts.hint['data-open']).toBe('')
    expect(first.parts.text).toBeUndefined()
    unbind()
    expect(last.parts.text).toBeUndefined()
    last.leave()
    first.leave()
})

// 50.86, 50.87 — A HINT'S TEXT IS MARKDOWN: the host hands it back rendered, its link as its text and
// its heading the deepest, and as plain text; the anchor is described by the plain text. THE REVERT: hand
// `text` back as it was given, as the host once did, and it reads `### Rare\n**Seen** on [2 days](/days).`
// where `Rare\nSeen on 2 days.` is due; describe the anchor by it, and so does the anchor; render
// with `markdown`'s own links, and the html carries `<a href="/days">2 days</a>` (50.47).
test('a hint is markdown, shown rendered and described as plain text — 50.23, 50.86, 50.87', async () => {
    const shown = standing()
    const source = '### Rare\n**Seen** on [2 days](/days).\n\n- 1 < 2 & 3'
    const unbind = await opened(source)
    expect(shown.parts.html).toBe(
        '<h6>Rare</h6><p><strong>Seen</strong> on 2 days.</p><ul><li>1 &lt; 2 &amp; 3</li></ul>',
    )
    expect(shown.parts.text).toBe('Rare\nSeen on 2 days.\n1 < 2 & 3')
    expect(tip(source)['aria-description']).toBe(
        'Rare\nSeen on 2 days.\n1 < 2 & 3',
    )
    unbind()
    expect(shown.parts.html).toBeUndefined()
    shown.leave()
})

// 50.21 — A HINT TAKES EVERY PLACEMENT OPTION `popover` DOES: one at the viewport's left edge given a
// `margin` keeps that far in. THE REVERT: hand `anchored` only the side, the alignment, the offset and
// the arrow inset, as the host once did, and the hint sits 8 in where 30 is due.
test('a hint keeps the margin it is given from the viewport — 50.21', async () => {
    for (const [name, value] of [
        ['clientWidth', 400],
        ['clientHeight', 300],
    ] as const)
        Object.defineProperty(document.documentElement, name, {
            configurable: true,
            get: () => value,
        })
    const shown = standing()
    const popover = document.body.appendChild(document.createElement('span'))
    popover.setAttribute('popover', 'manual')
    popover.getBoundingClientRect = () =>
        DOMRect.fromRect({ x: 0, y: 0, width: 120, height: 30 })
    const bind = shown.parts.hint['bind:element'] as (
        element: HTMLElement,
    ) => () => void
    const release = bind(popover)
    const anchor = document.body.appendChild(document.createElement('button'))
    anchor.getBoundingClientRect = () =>
        DOMRect.fromRect({ x: 0, y: 100, width: 20, height: 20 })
    const unbind = bindPart(tip('Signed.', { delay: 0, margin: 30 }), anchor)
    anchor.dispatchEvent(
        new PointerEvent('pointerenter', { pointerType: 'mouse' }),
    )
    await Bun.sleep(1)
    flushSync()
    expect(popover.style.inset.split(' ').at(-1)).toBe('30px')
    unbind()
    release()
    shown.leave()
})

// 52.67 — A SLICE'S HINT OPENS AGAINST ITS OWN ARC, its element being a circle as wide as the ring
// whatever it sweeps. The last quarter of a ring 100 across at (0, 100) spans x 0-50, so a hint 20
// wide centers at 25. THE REVERT: bind the slice with `tip(text)`, as `pie` once did, and the hint
// centers on the whole ring — `40px`, where `15px` is due.
test("a pie slice's hint opens against its own arc, not the ring — 52.67", async () => {
    for (const [name, value] of [
        ['clientWidth', 400],
        ['clientHeight', 300],
    ] as const)
        Object.defineProperty(document.documentElement, name, {
            configurable: true,
            get: () => value,
        })
    const shown = standing()
    const popover = document.body.appendChild(document.createElement('span'))
    popover.setAttribute('popover', 'manual')
    popover.getBoundingClientRect = () =>
        DOMRect.fromRect({ x: 0, y: 0, width: 20, height: 10 })
    const release = (
        shown.parts.hint['bind:element'] as (element: HTMLElement) => () => void
    )(popover)
    const ring = pie({
        slices: [
            { label: 'Won', value: 3 },
            { label: 'Lost', value: 1 },
        ],
        label: 'Outcomes',
    })
    const SVG = 'http://www.w3.org/2000/svg'
    const svg = document.body.appendChild(document.createElementNS(SVG, 'svg'))
    svg.getBoundingClientRect = () =>
        DOMRect.fromRect({ x: 0, y: 100, width: 100, height: 100 })
    const circle = svg.appendChild(document.createElementNS(SVG, 'circle'))
    circle.getBoundingClientRect = svg.getBoundingClientRect
    const lost = ring.slices[1]?.circle as {
        'bind:element': (element: Element) => () => void
    }
    const unbind = lost['bind:element'](circle)
    circle.dispatchEvent(
        new PointerEvent('pointerenter', { pointerType: 'mouse' }),
    )
    await Bun.sleep(350)
    flushSync()
    expect(popover.style.inset).toBe('82px auto auto 15px')
    unbind()
    release()
    shown.leave()
})

// 50.23, 50.87, 52.67 — A SLICE IS DESCRIBED AS A TIP'S ANCHOR IS: by its hint's plain text. THE
// REVERT: describe the slice by its hint as written, as `pie` once did, and it reads `**Won**: 3 (75%)`
// where `Won: 3 (75%)` is due.
test("a pie slice is described by its hint's plain text — 50.87, 52.67", () => {
    const ring = pie({
        slices: [
            { label: '**Won**', value: 3 },
            { label: 'Lost', value: 1 },
        ],
        label: 'Outcomes',
    })
    expect(ring.slices[0]?.circle['aria-description']).toBe('Won: 3 (75%)')
})
