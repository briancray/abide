// 32.9 — THE NODE, WHERE THE VALUE IS NOT ENOUGH. Focus, `scrollIntoView`, a measurement, a
// canvas, a third-party widget: the handful of things a page cannot express as a value need the
// real element, and this is how it arrives.
//
// THE DISPOSER IS THE HALF WORTH TESTING. Both forms hand the node over and a test that only
// reads it back passes against a binding that never tears anything down — so what a widget
// actually depends on is asserted through a region that LEAVES.

import { afterAll, expect, test } from 'bun:test'
import { parseAbide } from '#compiler'
import { emitSource } from '#compiler/emitSource.ts'
import { TypeSession } from '#compiler/TypeSession.ts'
import { render } from '#server'
import { flushSync } from '#shared'
import { pageRegion, type Region } from '#ui/regions.ts'
import type { Scope } from '#ui/Scope.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)
afterAll(async () => {
    await session.close()
    removeTemporaryModules()
})

async function mountPage(source: string): Promise<string> {
    const file = parseAbide(source)
    const names = await session.reads(`${ROOT}src/page.abide`, file)
    const { server, client } = emitSource(
        'ui/pages/page.abide',
        file,
        names,
        false,
    )
    const dir = temporaryModule({ 'Page.ts': server, 'Page.client.ts': client })
    const { default: Component } = await import(`${dir}/Page.ts`)
    let html = ''
    html += new TextDecoder().decode(
        await render(
            Component,
            '<!doctype html><html><head></head><body></body></html>',
        ),
    )
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + '<body>'.length,
        html.indexOf('</body>'),
    )
    const { default: mount } = await import(`${dir}/Page.client.ts`)
    ;(mount as (root: Region) => Scope)(pageRegion(document.body))
    return html
}

const click = (selector: string): void => {
    ;(document.querySelector(selector) as HTMLElement).click()
    flushSync()
}

// THE REVERT: what this replaced. `bind:element=""` was written into the markup — inert, ignored
// by a browser, and the node never reached anything.
test('a callback is handed the node, and the server writes no attribute — 32.9', async () => {
    const html = await mountPage(`<script>
import { reactive } from 'abide'

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
import { reactive } from 'abide'

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
import { reactive } from 'abide'

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
import { reactive } from 'abide'

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
