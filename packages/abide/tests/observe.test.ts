// 32.79, 32.80 — AN ELEMENT'S SIZE AND WHETHER IT IS IN VIEW, WRITTEN INTO A VALUE BY `observe`. What a page
// otherwise wires by hand: an observer, a map from each element to its callback, and the teardown
// that unobserves — and the version written per component is an observer per element.
//
// THE OBSERVERS ARE COUNTED, NOT TIMED. The emulator never lays anything out, so each observer here
// is a stand-in installed before the first bind makes the shared one, which records what was
// observed and hands deliveries over when a test says so. Whether a real browser delivers is the
// browser spec's (`e2e/observe.spec.ts`).

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
        // Every observer made with a root, by it: what it observes, and whether it was disconnected.
        rooted: new Map<
            unknown,
            { observed: Set<Element>; disconnected: boolean }[]
        >(),
        // The box each element was last observed with.
        boxes: new Map<Element, string | undefined>(),
    }
    class StandIn {
        own: { observed: Set<Element>; disconnected: boolean } | undefined
        constructor(deliver: Delivery, options?: { root?: unknown }) {
            counts.made += 1
            counts.deliver = deliver
            if (options?.root == null) return
            this.own = { observed: new Set(), disconnected: false }
            const made = counts.rooted.get(options.root) ?? []
            made.push(this.own)
            counts.rooted.set(options.root, made)
        }
        observe(element: Element, options?: { box?: string }): void {
            ;(this.own?.observed ?? counts.observed).add(element)
            counts.boxes.set(element, options?.box)
        }
        unobserve(element: Element): void {
            ;(this.own?.observed ?? counts.observed).delete(element)
        }
        disconnect(): void {
            if (this.own === undefined) counts.observed.clear()
            else {
                this.own.observed.clear()
                this.own.disconnected = true
            }
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

// 32.82 — THE VALUE HOLDS WHAT THE AUTHOR GAVE IT UNTIL THE FIRST DELIVERY, and a delivery writes
// it. A `bind:element` list hands the element to both adaptors (32.9).
test('a delivery writes the value, and nothing before it does — 32.79, 32.80, 32.82', async () => {
    const { html } = await mountPage(`<script>
import { observe, reactive } from '@abide/abide'

let box = reactive({ width: 0, height: 0 })
let seen = reactive(false)
</script>

<div id="panel" bind:element={[observe.size(box), observe.visible(seen)]}></div>
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
import { observe, reactive } from '@abide/abide'

let rows = reactive(Array.from({ length: 50 }, (_, index) => ({ id: index, box: reactive(), seen: reactive(false) })))
</script>

<button id="clear" onclick={() => { rows = [] }}>clear</button>
{#for row of rows by row.id}<div class="row" bind:element={[observe.size(row.box), observe.visible(row.seen)]}>{row.id}</div>{/for}`

// 32.81 — ONE OBSERVER EACH FOR FIFTY ELEMENTS, and every element observed by it. THE REVERT:
// make the observer per call in `size` / `visible` (`const observer = new ResizeObserver(…)`
// in place of `observer ??=`) — `made` reads 51 and 51, one per row past the first test's.
test('fifty observed elements share one observer of each kind — 32.81', async () => {
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

// 32.83 — A ROW THAT LEAVES IS UNOBSERVED, so the observer holds no node that left the
// document. THE REVERT: drop the `unobserve` from the `Disposer` `size` and `visible` hand back;
// after the clear 50 elements stay observed by each.
test('an element that leaves is unobserved — 32.83', async () => {
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
// drop the `held` compare in `deliverSizes`; the callback form, held to the same compare against
// what it was last handed, is called 2 times for one size, and the area computed 2 times.
test('a delivery of the size already held wakes nobody — 32.79', async () => {
    ;(globalThis as { __AREAS__?: number }).__AREAS__ = 0
    await mountPage(`<script>
import { reactive } from '@abide/abide'

import { observe } from '@abide/abide'

let box = reactive({ width: 10, height: 10 })
let calls = reactive(0)
const area = reactive(() => {
    ;(globalThis as { __AREAS__?: number }).__AREAS__ = ((globalThis as { __AREAS__?: number }).__AREAS__ ?? 0) + 1
    return box.width * box.height
})
</script>

<div id="sized" bind:element={observe.size(box)}></div>
<div id="called" bind:element={observe.size(() => { calls = calls + 1 })}></div>
<p id="area">{area}</p>
<p id="calls">{calls}</p>`)
    const sized = document.getElementById('sized') as Element
    const called = document.getElementById('called') as Element
    const before = (globalThis as { __AREAS__?: number }).__AREAS__ ?? 0
    resize.counts.deliver?.([sizeOf(sized, 10, 10), sizeOf(called, 10, 10)])
    flushSync()
    resize.counts.deliver?.([sizeOf(sized, 20, 10), sizeOf(called, 10, 10)])
    flushSync()
    expect(document.getElementById('calls')?.textContent).toBe('1')
    expect(document.getElementById('area')?.textContent).toBe('200')
    expect(
        `area computed ${((globalThis as { __AREAS__?: number }).__AREAS__ ?? 0) - before} times`,
    ).toBe('area computed 1 times')
})

// 32.91 — A MEASUREMENT WRITTEN AS AN ATTRIBUTE IS REFUSED, naming the adaptor that is one. THE
// REVERT: empty `MEASURED` in `classifyTemplate.ts`; every spelling below compiles, `bind:size`
// refused only as a bind of nothing (32.74) and `visibleIn` written as an attribute.
test('a measured bind or option is refused with the observe spelling — 32.91', () => {
    const refusedFor = (template: string): string => {
        try {
            emitClient(parseAbide(template))
        } catch (thrown) {
            return (thrown as Error).message
        }
        return 'compiled'
    }
    expect(refusedFor('<input size="20" bind:size={box}>')).toContain(
        '`bind:size={x}` is `bind:element={observe.size(x)}`',
    )
    expect(refusedFor('<div bind:visible={seen}></div>')).toContain(
        '`bind:visible={x}` is `bind:element={observe.visible(x)}`',
    )
    expect(refusedFor('<div bind:rect={placed}></div>')).toContain(
        '`bind:rect={x}` is `bind:element={observe.rect(x)}`',
    )
    expect(refusedFor('<p visibleIn={box}></p>')).toContain(
        'observe.visible(x, { in: root })',
    )
    expect(refusedFor('<p sizeBox="border"></p>')).toContain(
        "observe.size(x, { box: 'border' })",
    )
    expect(refusedFor('<div bind:sizes={box}></div>')).toContain(
        'RULEBOOK 32.74',
    )
    expect(refusedFor('<div bind:element={observe.size(box)}></div>')).toBe(
        'compiled',
    )
})

const ROOTED = `<script>
import { observe, reactive } from '@abide/abide'

let scroller = reactive<HTMLElement>()
let rooted = reactive(true)
const root = reactive(() => (rooted ? scroller : undefined))
let rows = reactive(Array.from({ length: 20 }, (_, index) => ({ id: index, seen: reactive(true) })))
</script>

<button id="unroot" onclick={() => { rooted = !rooted }}>unroot</button>
<button id="clear" onclick={() => { rows = [] }}>clear</button>
<div id="scroller" bind:element={scroller}>
    {#for row of rows by row.id}<p class="row" bind:element={observe.visible(row.seen, { in: root })}>{row.id}</p>{/for}
</div>`

// 32.81, 32.89 — TWENTY ELEMENTS IN ONE SCROLLER ARE ONE OBSERVER, rooted at the scroller, and none
// of them is observed against the viewport. A root that goes is every element unobserved and the
// observer disconnected; one that comes back is a new observer. THE REVERT: make `observeIn` build a
// `new Rooted(root)` for every element rather than look it up in `rooted`; 20 observers are made.
// 31.3 — `{ in: root }` HANDS OVER THE `Reactive`: drop the object-literal arm of `declaredType` and
// the root is read once, before the scroller is bound — 0 observers for the scroller.
test('every observe.visible in one root shares one observer, gone with the root — 32.81, 32.89', async () => {
    await mountPage(ROOTED)
    flushSync()
    const scroller = document.getElementById('scroller') as Element
    const rows = [...document.querySelectorAll('.row')]
    expect(rows).toHaveLength(20)
    const made = intersect.counts.rooted.get(scroller) ?? []
    expect(`observers for the scroller: ${made.length}`).toBe(
        'observers for the scroller: 1',
    )
    const [shared] = made as [{ observed: Set<Element>; disconnected: boolean }]
    expect(shared.observed.size).toBe(20)
    for (const row of rows)
        expect(intersect.counts.observed.has(row)).toBe(false)
    // A delivery from the rooted observer writes the row's value, as the viewport's does.
    intersect.counts.deliver?.([{ target: rows[3], isIntersecting: false }])
    flushSync()
    click('#unroot')
    flushSync()
    expect(shared).toEqual({ observed: new Set(), disconnected: true })
    click('#unroot')
    flushSync()
    expect(intersect.counts.rooted.get(scroller)).toHaveLength(2)
    const again = (intersect.counts.rooted.get(scroller) ?? [])[1] as {
        observed: Set<Element>
        disconnected: boolean
    }
    expect(again.observed.size).toBe(20)
    click('#clear')
    flushSync()
    expect(again).toEqual({ observed: new Set(), disconnected: true })
})

// 32.90 — A BORDER BOX IS READ FROM `borderBoxSize` AND TURNED INTO THE PHYSICAL AXES: a vertical
// writing mode's inline size is its height. `box` changing is the element observed again with
// the new box. THE REVERT: write `inlineSize` and `blockSize` as width and height whatever the writing
// mode in `deliverSizes`; the vertical box reads 124x224. 31.3 — the shorthand `{ box }` hands over
// the `Reactive` too: hold only a `value` read in `readsIn`, and the toggle leaves `border-box`.
test("box: 'border' writes the border box in physical axes — 32.90", async () => {
    await mountPage(`<script>
import { observe, reactive } from '@abide/abide'

let flat = reactive({ width: 0, height: 0 })
let upright = reactive({ width: 0, height: 0 })
let content = reactive(false)
const box = reactive(() => (content ? 'content' : 'border') as 'content' | 'border')
</script>

<button id="toggle" onclick={() => { content = !content }}>toggle</button>
<div id="flat" bind:element={observe.size(flat, { box })}></div>
<div id="upright" style="writing-mode: vertical-rl" bind:element={observe.size(upright, { box: 'border' })}></div>
<p id="out">{flat.width}x{flat.height} {upright.width}x{upright.height}</p>`)
    const flat = document.getElementById('flat') as Element
    const upright = document.getElementById('upright') as Element
    expect(resize.counts.boxes.get(flat)).toBe('border-box')
    const entry = (target: Element, inlineSize: number, blockSize: number) => ({
        target,
        contentRect: { width: 0, height: 0 },
        borderBoxSize: [{ inlineSize, blockSize }],
    })
    resize.counts.deliver?.([entry(flat, 224, 124), entry(upright, 124, 224)])
    flushSync()
    expect(document.getElementById('out')?.textContent).toBe('224x124 224x124')
    click('#toggle')
    flushSync()
    expect(resize.counts.boxes.get(flat)).toBe(undefined)
    resize.counts.deliver?.([sizeOf(flat, 200, 100)])
    flushSync()
    expect(document.getElementById('out')?.textContent).toBe('200x100 224x124')
})

// 32.92 — ONE ELEMENT TAKES ONE ADAPTOR OF A KIND: a second would take the first one's deliveries
// and its teardown. THE REVERT: drop the `has` check in `size`; the second binds, and the first
// stops being written.
test('a second observe.size on one element throws — 32.92', async () => {
    const { observe } = await import('#shared')
    const element = document.createElement('div')
    const stop = observe.size(() => {})(element)
    expect(() => observe.size(() => {})(element)).toThrow('RULEBOOK 32.92')
    stop()
    observe.size(() => {})(element)()
})
