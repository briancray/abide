// 14.2 — A TEMPLATE EXPRESSION MUST TRACK THE `Reactive` VALUES IT READS, and "it reads" is not
// "it names". `{big()}` over a plain function whose body reads `n` reads `n`, and so does
// `{box.value}` where `box` is typed `any` and `value` is a getter — but neither names a
// `Reactive` where the checker can see it, and both were emitted as text the server wrote once and
// nothing ever wrote again.
//
// SO THE RULE IS INVERTED: a position is written once only where the checker PROVED it reads
// nothing reactive (`provePosition`), and everything unproven is bound, runtime tracking (14.11)
// deciding what it actually reads. The cost side is the other half of these gates — a proven
// position still opens nothing, which is what the mount's `wakes` count says.

import { afterAll, expect, test } from 'bun:test'
import { measure } from 'harness/measure'
import { flushSync } from '#shared'
import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, renderPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

// `renderPage`, mounted under the counters.
async function mountPage(source: string) {
    const { html, client, mount } = await renderPage(source)
    return { html, client, mounting: measure(mount) }
}

const click = (selector: string): void => {
    ;(document.querySelector(selector) as HTMLElement).click()
    flushSync()
}

// A CALL THE CHECKER CANNOT SEE INTO. `big` is a plain function; the read of `n` is in its body.
//
// THE REVERT: make `isLive` answer `false` for a span with no reactive read in it (the old
// `readsIn`) — the server writes `2` and this reports `2` where `4` is due after the click.
test('a text run calling a function that reads a reactive value moves — 14.2', async () => {
    await mountPage(`<script>
import { reactive } from '@abide/abide'

let n = reactive(1)
function big() { return n * 2 }
</script>

<p id="out">{big()}</p>
<button onclick={() => { n = 2 }}>more</button>`)
    const out = document.querySelector('#out') as HTMLElement
    expect(out.textContent).toBe('2')
    click('button')
    expect(out.textContent).toBe('4')
})

// THE SAME READ FROM AN ATTRIBUTE. THE REVERT: the same one; `title` stays `2`.
test('an attribute calling a function that reads a reactive value moves — 14.2, 32.3', async () => {
    await mountPage(`<script>
import { reactive } from '@abide/abide'

let n = reactive(1)
function big() { return n * 2 }
</script>

<p id="out" title={big()}>x</p>
<button onclick={() => { n = 2 }}>more</button>`)
    const out = document.querySelector('#out') as HTMLElement
    expect(out.getAttribute('title')).toBe('2')
    click('button')
    expect(out.getAttribute('title')).toBe('4')
})

// A VALUE TYPED `any`, reached through a member. The getter reads `n`; nothing the checker holds
// says so, because `any` has no members to ask about. THE REVERT: the same one; `1` stays.
test('a member of a value typed any is bound — 14.2', async () => {
    await mountPage(`<script>
import { reactive } from '@abide/abide'

let n = reactive(1)
const box: any = { get value() { return n() } }
</script>

<p id="out">{box.value}</p>
<button onclick={() => { n = 2 }}>more</button>`)
    const out = document.querySelector('#out') as HTMLElement
    expect(out.textContent).toBe('1')
    click('button')
    expect(out.textContent).toBe('2')
})

// 41.4 ON THE SERVER, THROUGH THE SAME GAP. An unlanded `n` read inside `big()` threw out of the
// one concatenation the server builds, and `render` died with the whole document — `unlandable`
// asked whether the slot NAMED a `Reactive`. THE REVERT: the same one; `render` throws
// `NotLanded` and this reports no document.
test('a render continues past a function reading an unlanded value — 41.4', async () => {
    const { html } = await mountPage(`<script>
import { reactive } from '@abide/abide'

const n = reactive(() => Promise.resolve(1))
function big() { return n * 2 }
</script>

<main><h1 id="static">Total</h1><p id="out">{big()}</p></main>`)
    expect(html).toContain('<h1 id="static">Total</h1>')
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(document.querySelector('#out')?.textContent).toBe('2')
})

// THE COST SIDE: what the checker CAN prove is still written once and never bound. A page of
// proven positions — a primitive `const`, a member of plain data, arithmetic and a template
// literal over them, a row's own item member — beside ONE live slot, so the case distinguishes: a
// page whose only slot is live reports one wake whether the proof works or not.
//
// THE ROW'S ITEM IS TYPED, which is what makes `{row.title}` provable at all: the projection used
// to bind it `any`, and a member of `any` is exactly what the gate above must bind.
//
// THREE REVERTS, one per half of the proof. Make `isLive` answer `true` unconditionally and every
// position is bound: `wakes` 12 where 2 is due. Bind the row's item `any` again in `projectShadow`
// and the row's two positions are unprovable: 6. Watch every `{#if}` whatever its subject in
// `emitBlock`: 3.
test('a provably static position opens no binding', async () => {
    const { mounting, client } = await mountPage(`<script>
import { reactive } from '@abide/abide'

let count = reactive(0)
const label = 'clicks'
const card = { title: 'Card', size: 3 }
const shown = true
let rows = reactive([{ id: 1, title: 'one' }, { id: 2, title: 'two' }])
</script>

<p id="a" data-size={card.size}>{label}: {label.length + 1}</p>
<p id="b" title={\`\${card.title}!\`}>{card.size > 2 ? 'big' : 'small'}</p>
{#if shown}<i id="c">{card.title}</i>{/if}
<ul>{#for row of rows by row.id}<li class={row.title}>{row.title}</li>{/for}</ul>
<p id="live">{count}</p>`)
    expect(document.querySelector('#a')?.textContent).toBe('clicks: 7')
    expect(document.querySelector('#b')?.getAttribute('title')).toBe('Card!')
    expect(document.querySelector('#c')?.textContent).toBe('Card')
    // The live slot and the list's watch. A row's own proven positions open nothing, and the
    // `{#if}` over a proven subject decides its arm once.
    expect(mounting.wakes).toBe(2)
    expect(client).not.toContain('__setAttribute')
    expect(client.match(/\.watch\(/g) ?? []).toHaveLength(2)
})
