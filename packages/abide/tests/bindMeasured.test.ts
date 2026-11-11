// 32.79, 32.80 — AN ELEMENT'S SIZE AND WHETHER IT IS IN VIEW, WRITTEN INTO A VALUE. What a page
// otherwise wires by hand: an observer, a map from each element to its callback, and the teardown
// that unobserves — and the version written per component is an observer per element.
//
// THE OBSERVERS ARE COUNTED, NOT TIMED. The emulator never lays anything out, so each observer here
// is a stand-in installed before the first bind makes the shared one, which records what was
// observed and hands deliveries over when a test says so. Whether a real browser delivers is the
// browser spec's (`e2e/measured.spec.ts`).

import { afterAll, expect, test } from 'bun:test'

import { emitClient, parseAbide } from '#compiler'
import { flushSync } from '#shared'

import { click } from './click.ts'
import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, mountPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

type Delivery = (entries: unknown[]) => void

/** An observer that records what it watches and delivers only when told. */
function standIn() {
    const counts = {
        made: 0,
        observed: new Set<Element>(),
        deliver: undefined as Delivery | undefined,
    }
    class StandIn {
        constructor(deliver: Delivery) {
            counts.made += 1
            counts.deliver = deliver
        }
        observe(element: Element): void {
            counts.observed.add(element)
        }
        unobserve(element: Element): void {
            counts.observed.delete(element)
        }
        disconnect(): void {
            counts.observed.clear()
        }
    }
    return { counts, StandIn }
}

// Installed at load, ahead of every test: the shared observer is made by the first bind in the
// process and kept, so a stand-in installed later would never be asked.
const resize = standIn()
const intersect = standIn()
Object.assign(globalThis, {
    ResizeObserver: resize.StandIn,
    IntersectionObserver: intersect.StandIn,
})

const sizeOf = (target: Element, width: number, height: number) => ({
    target,
    contentRect: { width, height },
})

// 32.84, 32.83 — THE SERVER HAS NO LAYOUT, so it writes nothing for either bind, and the value holds what the
// author gave it until the first delivery. THE REVERT: classify a measured bind as `dynamic`; the
// tag carries `bind:size="[object Object]"` and the client sets it as an attribute.
test('the server writes nothing for bind:size or bind:visible, and a delivery writes the value — 32.79, 32.80, 32.84', async () => {
    const { html } = await mountPage(`<script>
import { reactive } from '@abide/abide'

let box = reactive({ width: 0, height: 0 })
let seen = reactive(false)
</script>

<div id="panel" bind:size={box} bind:visible={seen}></div>
<p id="out">{box.width}x{box.height} {seen}</p>`)
    expect(html).not.toContain('bind:')
    expect(html).toContain('<p id="out">0x0 false</p>')
    const panel = document.getElementById('panel') as Element
    resize.counts.deliver?.([sizeOf(panel, 320, 180)])
    intersect.counts.deliver?.([{ target: panel, isIntersecting: true }])
    flushSync()
    expect(document.getElementById('out')?.textContent).toBe('320x180 true')
})

const ROWS = `<script>
import { reactive } from '@abide/abide'

let rows = reactive(Array.from({ length: 50 }, (_, index) => ({ id: index, box: reactive(), seen: reactive(false) })))
</script>

<button id="clear" onclick={() => { rows = [] }}>clear</button>
{#for row of rows by row.id}<div class="row" bind:size={row.box} bind:visible={row.seen}>{row.id}</div>{/for}`

// 32.82 — ONE OBSERVER EACH FOR FIFTY ELEMENTS, and every element observed by it. THE REVERT:
// make the observer per call in `bindSize` / `bindVisible` (`const observer = new ResizeObserver(…)`
// in place of `observer ??=`) — `made` reads 51 and 51, one per row past the first test's.
test('fifty bound elements share one observer of each kind — 32.82', async () => {
    const madeBefore = [resize.counts.made, intersect.counts.made]
    await mountPage(ROWS)
    expect(document.querySelectorAll('.row')).toHaveLength(50)
    // The first test made both; a shared observer is never made again.
    expect(madeBefore).toEqual([1, 1])
    expect({
        resizeObservers: resize.counts.made,
        intersectionObservers: intersect.counts.made,
    }).toEqual({ resizeObservers: 1, intersectionObservers: 1 })
    let rows = 0
    for (const row of document.querySelectorAll('.row'))
        if (
            resize.counts.observed.has(row) &&
            intersect.counts.observed.has(row)
        )
            rows += 1
    expect(rows).toBe(50)
})

// 32.85 — A ROW THAT LEAVES IS UNOBSERVED, so the observer holds no node that left the
// document. THE REVERT: drop the `scope.stops.push` in `bindSize` and `bindVisible`; after the
// clear 50 elements stay observed by each.
test('an element that leaves is unobserved — 32.85', async () => {
    await mountPage(ROWS)
    const bound = [...document.querySelectorAll('.row')]
    click('#clear')
    flushSync()
    expect(document.querySelectorAll('.row')).toHaveLength(0)
    let stillObserved = 0
    for (const row of bound)
        if (
            resize.counts.observed.has(row) ||
            intersect.counts.observed.has(row)
        )
            stillObserved += 1
    expect(`still observed: ${stillObserved}`).toBe('still observed: 0')
})

// 32.79 — A SIZE THE VALUE ALREADY HOLDS IS NOT WRITTEN: a delivery builds a fresh record, which the
// value's identity gate cannot collapse, so the compare is what keeps a reader asleep. THE REVERT:
// drop the `held` compare in `deliverSizes`; the area is computed 2 times for one real change.
test('a delivery of the size already held wakes nobody — 32.79', async () => {
    ;(globalThis as { __AREAS__?: number }).__AREAS__ = 0
    await mountPage(`<script>
import { reactive } from '@abide/abide'

let box = reactive({ width: 10, height: 10 })
const area = reactive(() => {
    ;(globalThis as { __AREAS__?: number }).__AREAS__ = ((globalThis as { __AREAS__?: number }).__AREAS__ ?? 0) + 1
    return box.width * box.height
})
</script>

<div id="sized" bind:size={box}></div>
<p id="area">{area}</p>`)
    const sized = document.getElementById('sized') as Element
    const before = (globalThis as { __AREAS__?: number }).__AREAS__ ?? 0
    resize.counts.deliver?.([sizeOf(sized, 10, 10)])
    flushSync()
    resize.counts.deliver?.([sizeOf(sized, 20, 10)])
    flushSync()
    expect(document.getElementById('area')?.textContent).toBe('200')
    expect(
        `area computed ${((globalThis as { __AREAS__?: number }).__AREAS__ ?? 0) - before} times`,
    ).toBe('area computed 1 times')
})

// 32.72, 32.74 — A MEASURED BIND OWNS NO ATTRIBUTE: an input's `size` is its width in characters,
// and a measurement of the box beside it is a second thing rather than a second owner. THE REVERT:
// let `refuseBinds` check a measured bind's attribute; the input is refused under 32.72.
test('a measured bind compiles beside the attribute of its name — 32.72, 32.74', () => {
    const refusedFor = (template: string): string => {
        try {
            emitClient(parseAbide(template))
        } catch (thrown) {
            return (thrown as Error).message
        }
        return 'compiled'
    }
    expect(refusedFor('<input size="20" bind:size={box}>')).toBe('compiled')
    expect(refusedFor('<div bind:visible={seen}></div>')).toBe('compiled')
    expect(refusedFor('<div bind:sizes={box}></div>')).toContain(
        'RULEBOOK 32.74',
    )
})
