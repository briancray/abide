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
import { clientOf, closeTyped } from './typed.ts'

afterAll(closeTyped)

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
    const reactive = await session.reads(`${ROOT}src/page.abide`, file)

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
    // ONE TEXT RUN, written whole and carrying nothing the author did not. `{label}: {count}`
    // merges into a single text node when parsed, so there is nothing to separate and nothing
    // invented to separate it with.
    expect(html).toContain('<p id="out">clicks: 0</p>')
    expect(html).not.toContain('<!--')
    expect(html).not.toContain('data-a')
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

// A RUN reading nothing reactive is written once by the server and never again. The page below
// has TWO runs — one static, one live — which is what makes the case distinguish: a page whose
// only run is live reports one binding whether the check is there or not. THE REVERT: drop
// `readsReactive` in `emitClient` and bind every run; this reports 2 bindings where 1 is due, and
// the mount gate below reports `bindingRuns` 2 where it reports 1.
test('a run that reads nothing reactive opens no binding', async () => {
    const source = `<script>
import { reactive } from 'abide'

let count = reactive(0)
const label = 'clicks'
</script>

<p id="static">{label}</p>
<p id="live">{count}</p>`

    const file = parseAbide(source)
    const names = await session.reads(`${ROOT}src/page.abide`, file)
    const client = emitClient(file, names)

    // The live run is the only one bound. It is the ONLY binding on the page, so it walks its
    // own path and no anchor is emitted — an anchor for one binding saves nothing and costs a
    // line. The hoisting case is the test below.
    expect(client).toContain('__textAt(root, [1,0], true)')
    expect(client).not.toContain('__childAt(')
    // The STATIC run is still ADDRESSED, and that is not a binding: every part of it is an
    // expression, so it can render no node at all, and the index of everything after it in that
    // parent counts through the node `textAt` puts back. One line, and nothing reads it again.
    expect(client).toContain('__textAt(root, [0,0], true)')
    expect(client).not.toContain('__setText(__textAt(root, [0,0]')
    // `watchEffect` at the top level, `watch` inside a `{#if}` arm — the second is a local that
    // collects its disposer so a branch swap can stop it. Either spelling counts as a binding.
    expect(client.match(/watch(Effect)?\(/g) ?? []).toHaveLength(1)
})

// A page with nothing to hydrate emits no client module at all, which is what makes "this page
// ships no runtime" a fact about the build rather than a claim about the bundler.
test('a static page emits no client module', async () => {
    expect(await clientOf('<h1>static</h1>', [])).toBe('')
})
