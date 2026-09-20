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
    const names = await session.reads(`${ROOT}src/page.abide`, file)
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

    // THE REVERT: address the footer by child index in `planTemplate` — drop the region-reference
    // branch in `place()` and keep counting — and the taken arm's length decides which node `[2,0]`
    // is. With the else arm rendered it lands on the footer by luck; swap to the if arm below and
    // it lands on nothing, which is how this was found.
    //
    // `-1` is region 0 of the root and the `0` after it is how many nodes past its closing anchor
    // to count; the walk in `nodeAt` is what decodes the pair.
    const client = await clientOf(PAGE, ['open', 'name'])
    expect(client).toContain('__textAt(root, [-1,0,0]')
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

// WHICH REGION THIS IS AMONG ITS PARENT'S. `regionAt` counts opening anchors directly inside one
// node, so a region's index has to be counted the same way — per PARENT, not across the template.
//
// THE REVERT: number regions with `plan.regions.length`, which is flat because the walk recurses
// into an element's children with the same plan. The second `{#if}` below is then asked for as
// region 1 of the `<span>` that holds only one, and the mount throws `region 1 is not in the
// rendered document`. One region, or several under ONE parent, never sees it — which is every
// fixture there was.
const SPREAD = `<script>
import { reactive } from 'abide'

let open = reactive(true)
let name = reactive('ada')
</script>

<div id="left">{#if open}<b>{name}</b>{/if}</div>
<span id="right">{#if open}<i>{name}</i>{/if}</span>`

test('two regions under different parents each find their own', async () => {
    const { mount } = await mountPage(SPREAD)
    mount(document.body)
    expect((document.querySelector('#left b') as HTMLElement).textContent).toBe(
        'ada',
    )
    expect(
        (document.querySelector('#right i') as HTMLElement).textContent,
    ).toBe('ada')
})

// A REGION THAT IS NOT IN A DOCUMENT IS A MISMATCH, not a no-op. `fillRegion` cleared everything
// between the anchors unconditionally and then inserted through `region.close.parentNode?.`, so a
// detached close anchor emptied the region and dropped the new arm on the floor — the one silent
// failure in a module where every other one throws with the clause on it.
//
// THE REVERT: read the parent back off `region.close.parentNode?.insertBefore(...)` and remove the
// guard. This test then reports `no throw, content "" ` where the framed 41.11 error is due, and
// the arm that was there is gone as well.
test('filling a region that is not in a document is refused, not silent', async () => {
    const { fillRegion, regionAt } = await import('#ui')
    const holder = document.createElement('div')
    holder.innerHTML = '<!--[-->before<!--]-->'
    document.body.append(holder)
    const region = regionAt(holder, 0)
    expect(region.open.nextSibling?.textContent).toBe('before')
    // Detached: the anchors are still each other's siblings, but they have no parent.
    const orphan = document.createDocumentFragment()
    while (holder.firstChild !== null) orphan.append(holder.firstChild)
    orphan.removeChild(region.open)
    orphan.removeChild(region.close)

    let said = ''
    try {
        fillRegion(region, '<b>after</b>')
    } catch (thrown) {
        said = (thrown as Error).message
    }
    expect(said).toContain('not in a document')
    expect(said).toContain('41.11')
    holder.remove()
})
