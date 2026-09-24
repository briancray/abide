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
import { pageRegion } from '#ui/regions.ts'
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
    // 32.12 — ONE branch. `open` is false, so the else arm is what was sent.
    expect(html).toContain('<em id="shut">closed</em>')
    expect(html).not.toContain('id="body"')
    // The anchors, and nothing else added: no `data-`, no wrapper, no per-slot marker. Four is the
    // branch's pair and the page's own (41.9).
    expect(html).toContain('<!--[-->')
    expect(html).toContain('<!--]-->')
    expect(html).not.toContain('data-a')
    expect((html.match(/<!--/g) ?? []).length).toBe(4)
})

test('a sibling after the region is bound through the anchor, not by index', async () => {
    const { mount } = await mountPage(PAGE)
    mount(pageRegion(document.body))
    const foot = document.querySelector('#foot') as HTMLElement
    expect(foot.textContent).toBe('ada')

    // THE REVERT: continue past a region by counting its own nodes as if it were one — step from
    // the region's OPENING anchor in `Cursor.region` — and the taken arm's length decides which
    // node the footer is. How many nodes stand between the anchors depends on a value, so what
    // follows them is found from the one that stays put: the close.
    const client = await clientOf(PAGE, ['open', 'name'])
    expect(client).toContain('const __c3 = __c2?.close?.nextSibling')
})

test('a branch swap replaces the arm and nothing around it', async () => {
    const { mount } = await mountPage(PAGE)
    mount(pageRegion(document.body))

    expect(document.querySelector('#shut')).not.toBeNull()
    expect(document.querySelector('#body')).toBeNull()

    const top = document.querySelector('#top') as HTMLElement
    const foot = document.querySelector('#foot') as HTMLElement
    const button = document.querySelector('#go') as HTMLElement

    button.click()
    flushSync()

    // 32.12 — the other arm, and only it.
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
    mount(pageRegion(document.body))
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

// TWO REGIONS UNDER DIFFERENT PARENTS. When regions were NUMBERED, an index counted across the
// whole template rather than per parent asked the `<span>` below for a second region it does not
// hold. Nothing counts regions now — each is taken where the walk stands (`regionHere`) — so this
// holds the case that broke numbering rather than a number: both regions found, both live.
const SPREAD = `<script>
import { reactive } from 'abide'

let open = reactive(true)
let name = reactive('ada')
</script>

<div id="left">{#if open}<b>{name}</b>{/if}</div>
<span id="right">{#if open}<i>{name}</i>{/if}</span>`

test('two regions under different parents each find their own', async () => {
    const { mount } = await mountPage(SPREAD)
    mount(pageRegion(document.body))
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
// guard. This test then reports `no throw, content "" ` where the framed 41.10 error is due, and
// the arm that was there is gone as well.
test('filling a region that is not in a document is refused, not silent', async () => {
    const { fillRegion, regionFound, regionHere } = await import('#ui')
    const holder = document.createElement('div')
    holder.innerHTML = '<!--[-->before<!--]-->'
    document.body.append(holder)
    const region = regionFound(regionHere(holder.firstChild))
    expect(region.open.nextSibling?.textContent).toBe('before')
    // Detached: the anchors are still each other's siblings, but they have no parent.
    const orphan = document.createDocumentFragment()
    while (holder.firstChild !== null) orphan.append(holder.firstChild)
    orphan.removeChild(region.open)
    orphan.removeChild(region.close)

    let said = ''
    try {
        fillRegion(region, (made) => [made.createElement('b')])
    } catch (thrown) {
        said = (thrown as Error).message
    }
    expect(said).toContain('not in a document')
    expect(said).toContain('41.10')
    holder.remove()
})

// A REGION'S CLOSE IS THE ONE AT DEPTH ZERO. The walk steps past a region from its closing anchor,
// so a region holding another must hand back ITS OWN close and not the first one it meets — or
// every sibling after it is looked for inside it.
//
// THE REVERT: return at the first `REGION_CLOSE` in `regionHere`, ignoring depth. The outer region
// then ends at the inner one's close, and this reports `inner` where `after` is due.
test('a region holding a region is closed by its own anchor', async () => {
    const { regionHere } = await import('#ui')
    const holder = document.createElement('div')
    holder.innerHTML = '<!--[--><!--[-->inner<!--]--><!--]-->after'
    const outer = regionHere(holder.firstChild)
    expect(outer?.close.nextSibling?.textContent).toBe('after')
    // And something that is not an opening anchor is no region at all, rather than a throw — the
    // walk carries `undefined` on and `regionFound` refuses in the unit that needed it.
    expect(regionHere(holder.lastChild)).toBeUndefined()
    expect(regionHere(undefined)).toBeUndefined()
})
