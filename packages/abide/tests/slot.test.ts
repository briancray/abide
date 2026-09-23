// 32.19 — `<slot/>`, END TO END. A caller writes markup between a component's tags, the child
// decides where it goes, and the two halves of that sentence live in different files — which is
// the whole difficulty: the MARKUP belongs to the child's document position and the BINDINGS in
// it belong to the caller's scope.
//
// SO THE ASSERTIONS ARE IN PAIRS. A slot that only rendered would pass every string test here
// and be dead: the caller's button, the caller's value, and the caller's `{#if}` all have to go
// on working after they have been mounted inside somebody else's region.

import { afterAll, expect, test } from 'bun:test'
import { emitClient, emitComponent, parseAbide } from '#compiler'
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

// The layout shape: chrome of its own, and the caller's markup in the middle of it.
const CARD = `<script>
import { props } from 'abide'

const { title } = props<{ title: string }>()
</script>

<section class="card"><h2>{title}</h2><div class="body"><slot/></div></section>`

// 32.19's second row: children, or a fallback where the caller wrote none.
const NOTE = `<aside><slot>nothing yet</slot></aside>`

async function mountPage(
    page: string,
    components: Record<string, string>,
): Promise<{ html: string; mount: (root: unknown) => void }> {
    const modules: Record<string, string> = {}
    for (const [name, source] of Object.entries({
        ...components,
        Page: page,
    })) {
        const file = parseAbide(source)
        const reads = await session.reads(`${ROOT}src/${name}.abide`, file)
        modules[`${name}.ts`] = emitComponent(file, reads)
        modules[`${name}.client.ts`] =
            emitClient(file, reads, name !== 'Page' ? 'repeated' : 'none') ||
            'export default () => {}'
    }
    const dir = temporaryModule(modules)

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

const click = (selector: string): void => {
    ;(document.querySelector(selector) as HTMLElement).click()
    flushSync()
}

// THE REVERT: the throw this replaced — `<Card>` with children was a compile error naming 32.19.
test('a caller writes markup between the tags and the child places it — 32.19', async () => {
    const { html, mount } = await mountPage(
        `<script>
import { reactive } from 'abide'
import Card from './Card.abide'

let clicks = reactive(0)
</script>

<Card title="Totals"><p id="count">{clicks} so far</p><button id="bump" onclick={() => { clicks = clicks + 1 }}>+</button></Card>`,
        { Card: CARD },
    )

    // The child's chrome is around the caller's markup, and the caller's markup is where the
    // child put it rather than where it was written.
    expect(html).toContain('<h2>Totals</h2>')
    expect(html).toContain('<p id="count">0 so far</p>')
    expect(html.indexOf('class="body"')).toBeLessThan(
        html.indexOf('id="count"'),
    )

    // AND IT IS ALIVE. The binding and the listener are the CALLER's, mounted into a region the
    // child owns — which is the half a string assertion cannot see.
    mount(document.body)
    click('#bump')
    expect(document.querySelector('#count')?.textContent).toBe('1 so far')
})

test('a slot with no children renders its fallback — 32.19', async () => {
    const { html } = await mountPage(
        `<script>
import Note from './Note.abide'
</script>

<Note/>`,
        { Note: NOTE },
    )
    expect(html).toContain('nothing yet')
})

test('children given win over the fallback — 32.19', async () => {
    const { html } = await mountPage(
        `<script>
import Note from './Note.abide'
</script>

<Note><em id="mine">mine</em></Note>`,
        { Note: NOTE },
    )
    expect(html).toContain('<em id="mine">mine</em>')
    expect(html).not.toContain('nothing yet')
})

// A REGION INSIDE THE SLOT, which is where the addressing is easiest to get wrong: the arm's
// paths are counted from the slot's anchors, and the slot's from the child's.
test('a block inside the children swaps where the child put it — 32.12, 32.19', async () => {
    const { mount } = await mountPage(
        `<script>
import { reactive } from 'abide'
import Card from './Card.abide'

let open = reactive(false)
</script>

<Card title="Details"><button id="toggle" onclick={() => { open = !open }}>toggle</button>{#if open}<p id="shown">shown</p>{/if}</Card>`,
        { Card: CARD },
    )

    mount(document.body)
    expect(document.querySelector('#shown')).toBeNull()
    click('#toggle')
    expect(document.querySelector('#shown')?.textContent).toBe('shown')
    click('#toggle')
    expect(document.querySelector('#shown')).toBeNull()
})

// THE CHILD BUILT IN THE BROWSER, which is the lane where the caller's markup is not in the
// document at all: a row the client grew has no server markup behind it, so the child fills its
// own region (32.18) and the slot has to fill from the record the caller handed over.
// 33.16 — `children` is never declared, so passing it twice is a mistake with a silent shape:
// two keys of the same name in one record literal, the last one winning.
test('children as an attribute beside a body is refused — 33.16', async () => {
    const source = `<script>
import Note from './Note.abide'
</script>

<Note children="one">two</Note>`
    const file = parseAbide(source)
    expect(() => emitComponent(file, [])).toThrow('RULEBOOK 33.16')
})

test('a child grown in the browser fills its slot from the caller — 32.18, 32.19', async () => {
    const { mount } = await mountPage(
        `<script>
import { reactive } from 'abide'
import Card from './Card.abide'

let rows = reactive<string[]>([])
</script>

<button id="add" onclick={() => { rows = [...rows, 'one'] }}>add</button>
{#for row of rows}<Card title="Row"><span class="grown">{row}</span></Card>{/for}`,
        { Card: CARD },
    )

    mount(document.body)
    expect(document.querySelectorAll('.grown').length).toBe(0)
    click('#add')
    expect(document.querySelectorAll('.grown').length).toBe(1)
    expect(document.querySelector('.grown')?.textContent).toBe('one')
    // The child's own chrome came with it, so the fill is the whole template rather than the
    // slot's contents dropped into an empty region.
    expect(document.querySelector('.card h2')?.textContent).toBe('Row')
})
