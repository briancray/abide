// THE CLIENT HALF, END TO END. The server renders a document, the client mounts into the very
// nodes the server wrote, a real click runs a real handler, and the text the browser shows moves.
//
// The counts are the point rather than the text. A binding that produces the right string by
// rebuilding the subtree produces the right string, and CLAUDE.md's rule is that a correctness
// test cannot guard a "does less work" contract — so the gate is on nodes created and elements
// moved, both of which a naive re-render would raise and neither of which changes the output.

import { afterAll, expect, test } from 'bun:test'
import { measure } from 'harness/measure'
import { compileFile, emitClient, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { render } from '#server'
import { flushSync } from '#shared'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)

afterAll(() => {
    session.close()
    removeTemporaryModules()
})

const PAGE = `<script>
import { reactive } from 'abide'

let count = reactive(0)
const label = 'clicks'
</script>

<p id="out">{label}: {count}</p>
<button onclick={() => count = count + 1}>more</button>`

async function mountPage(source: string) {
    const file = parseAbide(source)
    const reactive = await session.reactiveNames(`${ROOT}src/page.abide`, file)

    const dir = temporaryModule({
        'Page.ts': compileFile(source, reactive),
        'Page.client.ts': emitClient(file, reactive),
    })

    const { default: Component } = await import(`${dir}/Page.ts`)
    let html = ''
    for await (const chunk of render(
        Component,
        '<!doctype html><html><head></head><body></body></html>',
    ))
        html += new TextDecoder().decode(chunk)

    // The client mounts into the SERVER's nodes. Setting innerHTML is how a browser would have
    // arrived at them; nothing is rebuilt from the template.
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + '<body>'.length,
        html.indexOf('</body>'),
    )
    const { default: mount } = await import(`${dir}/Page.client.ts`)
    return { html, mount }
}

test('a click runs the handler and the slot the server wrote is the slot that moves', async () => {
    const { html, mount } = await mountPage(PAGE)

    // The server rendered the initial value, so the document is right before any script runs.
    expect(html).toContain('<!--a-->clicks<!--/a-->')
    expect(html).toContain('<!--a-->0<!--/a-->')
    // 32.5 — the handler is a listener, and the server writes no `onclick` for it to fire from.
    expect(html).not.toContain('onclick')

    // MEASURED AT MOUNT, not only at the click, and the difference is where the gate lives.
    // 12.2 runs an effect immediately, so a binding opened for a static slot runs HERE and
    // never again — a click-only measurement reports the same 1 with the mechanism out and
    // distinguishes nothing, which is what the revert showed when this was written that way.
    const mountWork = measure(() => {
        mount(document.body)
        flushSync()
    })
    // Two slots on this page, ONE of which reads a reactive value. THE REVERT: drop the
    // `readsReactive` check in `emitClient`; this reports `bindingRuns` 1 -> 2 and `wakes`
    // 1 -> 2, and both grow with every static slot on the page.
    expect(mountWork.bindingRuns).toBe(1)
    expect(mountWork.wakes).toBe(1)

    const out = document.querySelector('#out') as HTMLElement
    const button = document.querySelector('button') as HTMLElement
    expect(out.textContent).toBe('clicks: 0')

    // THE REVERT: have `emitClient` re-render the element (`out.innerHTML = ...`) instead of
    // writing the slot's text node. The text is identical and this reports `nodesCreated` 0 -> 3
    // and `elementsMoved` 0 -> 1, neither of which the output shows.
    const work = measure(() => {
        button.click()
        flushSync()
    })
    expect(out.textContent).toBe('clicks: 1')
    expect(work.nodesCreated).toBe(0)
    expect(work.elementsMoved).toBe(0)
    expect(work.textMoved).toBe(0)

    // On the CLICK only the reactive slot may re-run. A static slot's binding, if one were
    // opened, would not show up here at all — which is exactly why the mount is measured above.
    expect(work.bindingRuns).toBe(1)
    expect(work.wakes).toBe(1)
})

// A slot reading nothing reactive is written once by the server and never again. THE REVERT:
// drop the `readsReactive` check in `emitClient` and bind every slot; `bindingRuns` on the click
// then reports 2 where 1 is due, and it grows with every static slot on the page.
test('a slot that reads nothing reactive opens no binding', async () => {
    const file = parseAbide(PAGE)
    const reactive = await session.reactiveNames(`${ROOT}src/page.abide`, file)
    const client = emitClient(file, reactive)
    expect(client).toContain('watch(() => setText(slotNodes[1], count()))')
    expect(client).not.toContain('slotNodes[0]')
})

// A page with nothing to hydrate emits no client module at all, which is what makes "this page
// ships no runtime" a fact about the build rather than a claim about the bundler.
test('a static page emits no client module', () => {
    expect(emitClient(parseAbide('<h1>static</h1>'), new Set())).toBe('')
})
