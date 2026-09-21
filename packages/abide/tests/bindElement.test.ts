// 32.9 — THE NODE, WHERE THE VALUE IS NOT ENOUGH. Focus, `scrollIntoView`, a measurement, a
// canvas, a third-party widget: the handful of things a page cannot express as a value need the
// real element, and this is how it arrives.
//
// THE DISPOSER IS THE HALF WORTH TESTING. Both forms hand the node over and a test that only
// reads it back passes against a binding that never tears anything down — so what a widget
// actually depends on is asserted through a region that LEAVES.

import { afterAll, expect, test } from 'bun:test'
import { compileFile, emitClient, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { render } from '#server'
import { flushSync } from '#shared'
import type { Scope } from '#ui/Scope.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)
afterAll(() => {
    session.close()
    removeTemporaryModules()
})

async function mountPage(source: string): Promise<string> {
    const file = parseAbide(source)
    const names = await session.reads(`${ROOT}src/page.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(source, names),
        'Page.client.ts': emitClient(file, names) || 'export default () => {}',
    })
    const { default: Component } = await import(`${dir}/Page.ts`)
    let html = ''
    for await (const chunk of render(
        Component,
        '<!doctype html><html><head></head><body></body></html>',
    ))
        html += new TextDecoder().decode(chunk)
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + '<body>'.length,
        html.indexOf('</body>'),
    )
    const { default: mount } = await import(`${dir}/Page.client.ts`)
    ;(mount as (root: Element) => Scope)(document.body)
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
