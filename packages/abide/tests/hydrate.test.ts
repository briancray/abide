// THE CLIENT HALF, END TO END. The server renders a document, the client mounts into the very
// nodes the server wrote, a real click runs a real handler, and the text the browser shows moves.
//
// The counts are the point rather than the text. A binding that produces the right string by
// rebuilding the subtree produces the right string, and CLAUDE.md's rule is that a correctness
// test cannot guard a "does less work" contract — so the gate is on nodes created and elements
// moved, both of which a naive re-render would raise and neither of which changes the output.

import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs' // bun has no sync mkdtemp/rm of its own
import { measure } from 'harness/measure'
import { compileFile, emitClient, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { render } from '#server'
import { flushSync } from '#shared'

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)

const temporary: string[] = []
afterAll(() => {
    session.close()
    for (const dir of temporary) rmSync(dir, { recursive: true, force: true })
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

    const dir = mkdtempSync(
        `${new URL('./', import.meta.url).pathname}hydrate-`,
    )
    temporary.push(dir)
    writeFileSync(`${dir}/Page.ts`, compileFile(source, reactive))
    writeFileSync(`${dir}/Page.client.ts`, emitClient(file, reactive))

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

    mount(document.body)
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

    // `bindingRuns` IS NOT ASSERTED HERE, and the reason is worth more than the assertion:
    // nothing in abide publishes `__ABIDE_WORK__`, so `bindingRuns`, `wakes` and `descents` are
    // all null. Publishing a partial record is WORSE than publishing none — the zeroing pass in
    // `armCase` writes all three, so a field nobody increments reads back 0 and every gate
    // asserting it passes against a counter that was never wired (44.24). The count that stands
    // in for it until the core publishes is the emitted-source gate below.
    expect(work.bindingRuns).toBeNull()
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
