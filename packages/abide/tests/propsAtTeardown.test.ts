// 33.28 — A PROP READ AT TEARDOWN ANSWERS WHAT IT LAST ANSWERED. The write that removes a component
// is the write its caller's expression reads, so a disposer reading the prop live reads the state
// that removed it: a `find` that no longer finds, and `.id` of `undefined` thrown out of a disposer.
//
// THE REVERT: drop `teardown.depth` from `Scope.stop` — the first two fail, each disposer throwing
// (which 12.6 only warns of) and recording nothing, while the page looks the same either way. The
// last two hold with it out: they are the reads left live (33.29, and 12.1's rerun).

import { afterAll, expect, test } from 'bun:test'

import { click } from './click.ts'
import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, mountPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

type Seen = { seen: unknown[] }
const record = globalThis as unknown as Seen
record.seen = []

// The server's render runs its disposers too (12.5): what the browser saw starts after the mount.
async function mounted(page: string, imports: Record<string, string>) {
    await mountPage(page, imports)
    record.seen = []
}

// The child reads its prop at mount and again as it goes.
const PANEL = `<script>
import { props, watch } from '@abide/abide'

const { item } = props<{ item: { id: string } }>()
watch(() => {
    const id = item.id
    return () => (globalThis as any).seen.push(['gone', item.id, id])
})
</script>

<b class="panel">{item.id}</b>`

test('an arm the removing write swaps out reads its prop as last answered — 33.28', async () => {
    await mounted(
        `<script>
import { reactive } from '@abide/abide'
import Panel from './Panel.abide'

let items = reactive([{ id: 'a' }, { id: 'b' }])
</script>

{#if items.some((each) => each.id === 'a')}
    <Panel item={items.find((each) => each.id === 'a') as { id: string }}/>
{/if}
<button id="drop" onclick={() => { items = items.filter((each) => each.id !== 'a') }}>drop</button>`,
        { Panel: PANEL },
    )
    expect(document.querySelector('b.panel')?.textContent).toBe('a')
    click('#drop')
    expect(document.querySelector('b.panel')).toBeNull()
    expect(record.seen).toEqual([['gone', 'a', 'a']])
})

// The trail map's shape: a row's child hands ITS child a callback reading its own prop, and the
// grandchild's disposer calls it — two accessors deep, each in a scope that is stopping.
const FORM = `<script>
import { props, watch } from '@abide/abide'

const { onclose } = props<{ onclose: () => void }>()
watch(() => () => onclose())
</script>

<i class="form"></i>`

const CARD = `<script>
import { props } from '@abide/abide'
import Form from './Form.abide'

const { key } = props<{ key: string }>()
</script>

<b class="card">{key}</b>
<Form onclose={() => (globalThis as any).seen.push(['closed', key])}/>`

test('a row dropped from its list reads its props as last answered, forwarded through a child — 33.28', async () => {
    await mounted(
        `<script>
import { reactive } from '@abide/abide'
import Card from './Card.abide'

let items = reactive([{ id: 'a' }, { id: 'b' }])
let ids = reactive(['a', 'b'])
</script>

{#for id of ids key id}
    <Card key={(items.find((each) => each.id === id) as { id: string }).id}/>
{/for}
<button id="drop" onclick={() => { items = items.filter((each) => each.id !== 'a'); ids = ['b'] }}>drop</button>`,
        { Card: CARD, Form: FORM },
    )
    expect(document.querySelectorAll('i.form').length).toBe(2)
    click('#drop')
    expect(document.querySelectorAll('i.form').length).toBe(1)
    expect(record.seen).toEqual([['closed', 'a']])
})

// One the child never read has nothing to answer with, and reads its caller's expression.
const LATE = `<script>
import { props, watch } from '@abide/abide'

const { label } = props<{ label: string }>()
watch(() => () => (globalThis as any).seen.push(['late', label]))
</script>

<i class="late"></i>`

test('a prop first read at teardown reads the caller’s expression — 33.29', async () => {
    await mounted(
        `<script>
import { reactive } from '@abide/abide'
import Late from './Late.abide'

let open = reactive(true)
let label = reactive('first')
</script>

{#if open}<Late label={label}/>{/if}
<button id="close" onclick={() => { label = 'second'; open = false }}>close</button>`,
        { Late: LATE },
    )
    click('#close')
    expect(record.seen).toEqual([['late', 'second']])
})

// A disposer running before its `Effect` reruns (12.1) is not a teardown, and reads live.
const RERUN = `<script>
import { props, watch } from '@abide/abide'

const { label } = props<{ label: string }>()
watch(() => {
    const now = label
    return () => (globalThis as any).seen.push(['before rerun', now, label])
})
</script>

<i class="rerun">{label}</i>`

test('a disposer before a rerun reads its props live — 12.1, 33.5', async () => {
    await mounted(
        `<script>
import { reactive } from '@abide/abide'
import Rerun from './Rerun.abide'

let label = reactive('first')
</script>

<Rerun label={label}/>
<button id="move" onclick={() => { label = 'second' }}>move</button>`,
        { Rerun: RERUN },
    )
    click('#move')
    expect(record.seen).toEqual([['before rerun', 'first', 'second']])
})
