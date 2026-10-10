// 32.34 — A TAG THAT CHOOSES ITS COMPONENT BY A VALUE. `<Shown/>` over a `Reactive` holding a
// component invokes whichever one it holds, the server rendering the one it held and the browser
// swapping when it moves. What is counted is 32.35's other half: a write that leaves the same
// component standing rebuilds nothing, which the output alone cannot tell from a rebuild.

import { afterAll, expect, test } from 'bun:test'
import { measure } from 'harness/measure'
import { flushSync } from '#shared'
import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, mountPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

const BAR = `<script>
import { props } from '@abide/abide'

const { label } = props<{ label: string }>()
</script>

<b class="bar">bar {label}</b>`

const BAZ = `<script>
import { props } from '@abide/abide'

const { label } = props<{ label: string }>()
</script>

<i class="baz">baz {label}</i>`

// 32.34's second binding: a component handed in as a prop, invoked by the name `props` gave it.
const FRAME = `<script>
import { props } from '@abide/abide'

const { as: Inner } = props<{ as: (...args: any[]) => unknown }>()
</script>

<section id="frame"><Inner label="framed"/></section>`

const click = (id: string): void => {
    ;(document.querySelector(id) as HTMLElement).click()
    flushSync()
}

const PAGE = `<script>
import { reactive } from '@abide/abide'
import Bar from './Bar.abide'
import Baz from './Baz.abide'

let which = reactive(0)
let label = reactive('one')
let Shown = reactive(() => (which % 2 === 0 ? Bar : Baz))
</script>

<div id="host"><Shown label={label}/></div>
<button id="flip" onclick={() => { which = which + 1 }}>flip</button>
<button id="label" onclick={() => { label = 'two' }}>label</button>`

test('a tag naming a Reactive invokes the component it holds, on both sides — 32.34', async () => {
    const { html } = await mountPage(PAGE, { Bar: BAR, Baz: BAZ })
    expect(html).toContain(
        '<div id="host"><!--[--><b class="bar">bar one</b><!--]--></div>',
    )
    const host = document.querySelector('#host') as HTMLElement
    // Hydrated, not rebuilt: the node the server wrote is the one standing.
    const painted = host.querySelector('b.bar')
    expect(painted?.textContent).toBe('bar one')

    click('#flip')
    expect(host.querySelector('b.bar')).toBeNull()
    expect(host.querySelector('i.baz')?.textContent).toBe('baz one')

    // The props record is the caller's accessors, so the child the value chose reads them live.
    click('#label')
    expect(host.querySelector('i.baz')?.textContent).toBe('baz two')

    click('#flip')
    expect(host.querySelector('i.baz')).toBeNull()
    expect(host.querySelector('b.bar')?.textContent).toBe('bar two')
})

// 32.35 — THE SAME COMPONENT IS NOT REBUILT. Through a prop, because a `Reactive` recomputing to
// the component it already held is cut off by its own identity check and never wakes the tag at
// all; a prop is the caller's expression, so `which` moving by two wakes the child's tag with the
// same `Bar` in hand, and the tag is what has to leave the region alone.
//
// THE REVERT: drop the `next !== _at` guard in `emitInvocation`'s watch — nodesCreated 0 -> 2
// (the `<b>` and its text), and the painted node is gone.
test('a write that leaves the same component rebuilds nothing — 32.35', async () => {
    await mountPage(
        `<script>
import { reactive } from '@abide/abide'
import Frame from './Frame.abide'
import Bar from './Bar.abide'
import Baz from './Baz.abide'

let which = reactive(0)
</script>

<Frame as={which % 2 === 0 ? Bar : Baz}/>
<button id="same" onclick={() => { which = which + 2 }}>same</button>`,
        { Bar: BAR, Baz: BAZ, Frame: FRAME },
    )
    const painted = document.querySelector('b.bar')
    expect(painted?.textContent).toBe('bar framed')
    const work = measure(() => click('#same'))
    expect(work.nodesCreated).toBe(0)
    expect(document.querySelector('b.bar')).toBe(painted)
})

test('an absent value renders nothing, and the region fills when one arrives — 32.36', async () => {
    const { html } = await mountPage(
        `<script>
import { reactive } from '@abide/abide'
import Bar from './Bar.abide'

let open = reactive(false)
let Shown = reactive(() => (open ? Bar : undefined))
</script>

<div id="host"><Shown label="x"/></div>
<button id="toggle" onclick={() => { open = !open }}>toggle</button>`,
        { Bar: BAR },
    )
    expect(html).toContain('<div id="host"><!--[--><!--]--></div>')
    const host = document.querySelector('#host') as HTMLElement

    click('#toggle')
    expect(host.querySelector('b.bar')?.textContent).toBe('bar x')

    click('#toggle')
    expect(host.querySelector('b.bar')).toBeNull()
    expect(host.innerHTML).toBe('<!--[--><!--]-->')
})

test('a tag naming a prop invokes the component the caller passed — 32.34', async () => {
    await mountPage(
        `<script>
import { reactive } from '@abide/abide'
import Frame from './Frame.abide'
import Bar from './Bar.abide'
import Baz from './Baz.abide'

let fancy = reactive(false)
</script>

<Frame as={fancy ? Baz : Bar}/>
<button id="fancy" onclick={() => { fancy = true }}>fancy</button>`,
        {
            Bar: BAR,
            Baz: BAZ,
            Frame: FRAME,
        },
    )
    const frame = document.querySelector('#frame') as HTMLElement
    expect(frame.querySelector('b.bar')?.textContent).toBe('bar framed')

    click('#fancy')
    expect(frame.querySelector('b.bar')).toBeNull()
    expect(frame.querySelector('i.baz')?.textContent).toBe('baz framed')
})
