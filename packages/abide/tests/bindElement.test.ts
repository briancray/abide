// 32.9 — THE NODE, WHERE THE VALUE IS NOT ENOUGH. Focus, `scrollIntoView`, a measurement, a
// canvas, a third-party widget: the handful of things a page cannot express as a value need the
// real element, and this is how it arrives.
//
// THE DISPOSER IS THE HALF WORTH TESTING. Both forms hand the node over and a test that only
// reads it back passes against a binding that never tears anything down — so what a widget
// actually depends on is asserted through a region that LEAVES.

import { afterAll, expect, test } from 'bun:test'
import { flushSync } from '#shared'
import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, mountPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

const click = (selector: string): void => {
    ;(document.querySelector(selector) as HTMLElement).click()
    flushSync()
}

// THE REVERT: what this replaced. `bind:element=""` was written into the markup — inert, ignored
// by a browser, and the node never reached anything.
test('a callback is handed the node, and the server writes no attribute — 32.9', async () => {
    const { html } = await mountPage(`<script>
import { reactive } from '@abide/abide'

let tag = reactive('')
</script>

<input id="field" bind:element={(node) => { tag = node.tagName }}>
<p id="seen">{tag}</p>`)

    expect(html).not.toContain('bind:element')
    flushSync()
    expect(document.querySelector('#seen')?.textContent).toBe('INPUT')
})

test('a Reactive takes the node — 32.9', async () => {
    await mountPage(`<script>
import { reactive } from '@abide/abide'

let field = reactive<HTMLInputElement>()
let note = reactive('')
</script>

<input id="field" bind:element={field} value="typed">
<button id="read" onclick={() => { note = field.value }}>read</button>
<p id="seen">{note}</p>`)

    click('#read')
    expect(document.querySelector('#seen')?.textContent).toBe('typed')
})

// 32.9's `Disposer`, which is what a third-party widget wants: set up where the node arrives and
// torn down where it goes. THE REVERT: drop the `stops.push` and the count stays at 0 — the
// widget is left running over nodes that have left the document.
test('the disposer runs when the region holding the node leaves — 32.9', async () => {
    ;(globalThis as { __TORN__?: number }).__TORN__ = 0
    await mountPage(`<script>
import { reactive } from '@abide/abide'

let open = reactive(true)
</script>

<button id="toggle" onclick={() => { open = !open }}>toggle</button>
{#if open}<div id="widget" bind:element={() => () => { (globalThis as { __TORN__?: number }).__TORN__ = ((globalThis as { __TORN__?: number }).__TORN__ ?? 0) + 1 }}>widget</div>{/if}`)

    expect(document.querySelector('#widget')).not.toBeNull()
    expect((globalThis as { __TORN__?: number }).__TORN__).toBe(0)
    click('#toggle')
    expect(document.querySelector('#widget')).toBeNull()
    expect((globalThis as { __TORN__?: number }).__TORN__).toBe(1)
})

// 32.38 — AN EXIT: a `Disposer` handing back a thenable keeps the element in the document until it
// settles, which is where `element.animate(…).finished` goes. An arm's swap and a row the reconcile
// drops both hold it, and the arm's replacement is in place beside it meanwhile. THE REVERT: have
// `leave` remove the node whatever is leaving; `#leaving` is gone at the swap, where it is due to
// stay until the exit settles.
test('a disposer handing back a thenable holds the element until it settles — 32.38', async () => {
    const exits: (() => void)[] = []
    ;(globalThis as { __EXIT__?: () => Promise<void> }).__EXIT__ = () =>
        new Promise<void>((done) => exits.push(done))
    await mountPage(`<script>
import { reactive } from '@abide/abide'

let open = reactive(true)
let rows = reactive([1, 2, 3])
const exit = () => () => (globalThis as { __EXIT__?: () => Promise<void> }).__EXIT__?.()
</script>

<button id="toggle" onclick={() => { open = !open }}>toggle</button>
<button id="drop" onclick={() => { rows = [1, 3] }}>drop</button>
{#if open}<p id="leaving" bind:element={exit}>arm</p>{:else}<p id="arrived">other</p>{/if}
<ul>{#for row of rows by row}<li id={\`row\${row}\`} bind:element={exit}>{row}</li>{/for}</ul>`)

    click('#toggle')
    expect(document.querySelector('#leaving')).not.toBeNull()
    expect(document.querySelector('#arrived')).not.toBeNull()
    click('#drop')
    expect(document.querySelector('#row2')).not.toBeNull()
    expect(exits.length).toBe(2)
    for (const done of exits) done()
    await Promise.resolve()
    await Promise.resolve()
    expect(document.querySelector('#leaving')).toBeNull()
    expect(document.querySelector('#row2')).toBeNull()
    expect(document.querySelector('#row3')).not.toBeNull()
})

// 32.66 THROUGH A COMPONENT SWAPPED IN ITS REGION (32.35): the leaving one's exit holds `#first`
// while the arriving one asks whether the region is empty. THE REVERT, run: drop the anchor move
// from `emptyRegion`; the held `#first` reads as painted markup and `#second` never builds.
test('a component swapped in while the last one is leaving builds its own markup — 32.66', async () => {
    const exits: (() => void)[] = []
    ;(globalThis as { __EXIT__?: () => Promise<void> }).__EXIT__ = () =>
        new Promise<void>((done) => exits.push(done))
    await mountPage(
        `<script>
import { reactive } from '@abide/abide'
import First from './First.abide'
import Second from './Second.abide'

let count = reactive(0)
let swapped = reactive(false)
let Shown = reactive(() => (swapped ? Second : First))
</script>

<button id="swap" onclick={() => { swapped = true }}>swap</button>
<button id="bump" onclick={() => { count = count + 1 }}>bump</button>
<div id="host"><Shown count={count}/></div>`,
        {
            First: `<script>
const exit = () => () => (globalThis as { __EXIT__?: () => Promise<void> }).__EXIT__?.()
</script>

<p id="first" bind:element={exit}>first</p>`,
            Second: `<script>
import { props } from '@abide/abide'

const { count } = props<{ count: number }>()
</script>

<p id="second">{count}</p>`,
        },
    )

    click('#swap')
    expect(document.querySelector('#first')).not.toBeNull()
    expect(document.querySelector('#second')?.textContent).toBe('0')
    click('#bump')
    expect(document.querySelector('#second')?.textContent).toBe('1')
    for (const done of exits) done()
    await Promise.resolve()
    await Promise.resolve()
    expect(document.querySelector('#first')).toBeNull()
    expect(document.querySelector('#second')?.textContent).toBe('1')
})

// 32.38 THROUGH AN EMPTIED LIST, which clears its region in one write where nothing is leaving.
// THE REVERT, run: drop `anyLeaving()` from `emptyRegion`'s guard; every row is gone at the
// clear, where each is due to stay until its exit settles.
test('an emptied list holds a leaving row until its exit settles — 32.38', async () => {
    const exits: (() => void)[] = []
    ;(globalThis as { __EXIT__?: () => Promise<void> }).__EXIT__ = () =>
        new Promise<void>((done) => exits.push(done))
    await mountPage(`<script>
import { reactive } from '@abide/abide'

let rows = reactive([1, 2, 3])
const exit = () => () => (globalThis as { __EXIT__?: () => Promise<void> }).__EXIT__?.()
</script>

<button id="empty" onclick={() => { rows = [] }}>empty</button>
<ul>{#for row of rows by row}<li id={\`row\${row}\`} bind:element={exit}>{row}</li>{/for}</ul>`)

    click('#empty')
    expect(document.querySelectorAll('ul li').length).toBe(3)
    expect(exits.length).toBe(3)
    for (const done of exits) done()
    await Promise.resolve()
    await Promise.resolve()
    expect(document.querySelectorAll('ul li').length).toBe(0)
})
