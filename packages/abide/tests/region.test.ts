// `{#if}` — THE FIRST DYNAMIC REGION, and the first place a compiled document carries anything an
// authored one does not. A region's content length depends on a value, so every sibling after it
// moves; the anchors are what those siblings are counted from instead.
//
// A comment is the only thing that may be added. `invariance.spec.ts` measures why: it joins no
// combinator chain, so descendant, `:has`, `+`, `~`, `:nth-child` and `:empty` all answer exactly
// as they would for the page the author wrote. A wrapper element breaks every one of them.

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

let open = reactive(false)
let name = reactive('ada')
</script>

<h1 id="top">{name}</h1>
{#if open}<p id="body">hello {name}</p>{:else}<em id="shut">closed</em>{/if}
<footer id="foot">{name}</footer>
<button id="go" onclick={() => open = !open}>toggle</button>
<button id="rename" onclick={() => name = name + '!'}>rename</button>`

async function mountPage(source: string) {
    const file = parseAbide(source)
    const names = await session.reactiveNames(`${ROOT}src/page.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(source, names),
        'Page.client.ts': emitClient(file, names),
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
    return { html, mount }
}

test('the server renders one branch, between anchors', async () => {
    const { html } = await mountPage(PAGE)
    // 32.13 — ONE branch. `open` is false, so the else arm is what was sent.
    expect(html).toContain('<em id="shut">closed</em>')
    expect(html).not.toContain('id="body"')
    // The anchors, and nothing else added: no `data-`, no wrapper, no per-slot marker.
    expect(html).toContain('<!--[-->')
    expect(html).toContain('<!--]-->')
    expect(html).not.toContain('data-a')
    expect((html.match(/<!--/g) ?? []).length).toBe(2)
})

test('a sibling after the region is bound through the anchor, not by index', async () => {
    const { mount } = await mountPage(PAGE)
    mount(document.body)
    const foot = document.querySelector('#foot') as HTMLElement
    expect(foot.textContent).toBe('ada')

    // THE REVERT: address the footer by child index in `planTemplate` — drop the `afterRegion`
    // branch and keep counting — and the taken arm's length decides which node `[2,0]` is. With
    // the else arm rendered it lands on the footer by luck; swap to the if arm below and it lands
    // on nothing, which is how this was found.
    const client = emitClient(parseAbide(PAGE), new Set(['open', 'name']))
    expect(client).toContain('afterRegion(regionAt(root, 0), 0)')
})

test('a branch swap replaces the arm and nothing around it', async () => {
    const { mount } = await mountPage(PAGE)
    mount(document.body)

    expect(document.querySelector('#shut')).not.toBeNull()
    expect(document.querySelector('#body')).toBeNull()

    const top = document.querySelector('#top') as HTMLElement
    const foot = document.querySelector('#foot') as HTMLElement
    const button = document.querySelector('#go') as HTMLElement

    button.click()
    flushSync()

    // 32.13 — the other arm, and only it.
    expect(document.querySelector('#shut')).toBeNull()
    expect((document.querySelector('#body') as HTMLElement).textContent).toBe(
        'hello ada',
    )

    // The nodes on either side are the SAME nodes. A region swap is the region's business and
    // nothing else's — and the footer is still bound, which is what proves the anchor addressing
    // survived the swap rather than merely surviving the first mount.
    expect(document.querySelector('#top')).toBe(top)
    expect(document.querySelector('#foot')).toBe(foot)
    expect(foot.textContent).toBe('ada')
})

// A BINDING IN THE ARM THAT WAS REPLACED MUST STOP. It can only be seen by WRITING what the dead
// arm read: a reader that wakes over a node no longer in the document changes nothing on screen,
// so the page looks right either way and only the count tells them apart.
//
// THE REVERT: return a no-op from the arm mount's disposer in `emitClient` instead of stopping
// what it collected. `bindingRuns` on a rename then reports 3 where 2 are due — the two live runs
// plus the `if` arm's `hello {name}`, still awake over a node that was removed.
test('the arm a swap replaced stops waking', async () => {
    const { mount } = await mountPage(PAGE)
    mount(document.body)
    const toggle = document.querySelector('#go') as HTMLElement
    const rename = document.querySelector('#rename') as HTMLElement

    // Two live runs on the page: `#top` and `#foot`, both reading `name`.
    const before = measure(() => {
        rename.click()
        flushSync()
    })
    expect(before.bindingRuns).toBe(2)

    // Into the `if` arm, whose body also reads `name` — three readers now.
    toggle.click()
    flushSync()
    const inside = measure(() => {
        rename.click()
        flushSync()
    })
    expect(inside.bindingRuns).toBe(3)

    // Back to the `else` arm, whose body reads nothing. The `if` arm's binding is gone with it.
    toggle.click()
    flushSync()
    const after = measure(() => {
        rename.click()
        flushSync()
    })
    expect(after.bindingRuns).toBe(2)
})
