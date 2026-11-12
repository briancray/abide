// 38.3, 38.138 — AN ARM IS CHECKED UNDER WHAT ITS CONDITION ESTABLISHED. `{#if}` is projected as the `if` it
// is, so a guard narrows the arm it opens, a discriminant narrows both sides of a union, and a guard
// inside a row narrows the row's item — the same page written in a `.ts` file would check.

import { afterAll, expect, test } from 'bun:test'

import { checkApp } from '#compiler/checkApp.ts'

import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

const NARROWED = `<script>
import { reactive } from '@abide/abide'

type Contact = { name: string; phone?: string }
let contact = reactive<Contact | undefined>(undefined)
let rows = reactive<(Contact | null)[]>([])
let status = reactive<{ kind: 'ok'; total: number } | { kind: 'failed'; reason: string }>({
    kind: 'ok',
    total: 1,
})
</script>

{#if contact}<p>{contact.name}</p>{#if contact.phone}<p>{contact.phone.length}</p>{/if}{:else}<p>none</p>{/if}
{#if status.kind === 'ok'}<p>{status.total}</p>{:else}<p>{status.reason}</p>{/if}
{#for row of rows}{#if row}<li>{row.name}</li>{/if}{/for}
`

// THE REVERT: project each subject as a bare `(subject)` statement beside its arms, as before; every
// arm is checked unnarrowed and this reports 7 errors where 0 are due.
test('an {#if} narrows the arm it opens, its {:else}, and a row inside a {#for}', async () => {
    const app = appFixture({ 'index.abide': NARROWED })
    const found = await checkApp(app)
    const errors = found.filter((one) => one.category === 'error')
    expect(errors.map((one) => one.message)).toEqual([])
}, 60_000)

// AND NOTHING WIDER: a read outside the guard is still the union it was.
test('a read outside the {#if} is not narrowed', async () => {
    const app = appFixture({
        'index.abide': `<script>
import { reactive } from '@abide/abide'

let contact = reactive<{ name: string } | undefined>(undefined)
</script>

{#if contact}<p>{contact.name}</p>{/if}<p>{contact.name}</p>
`,
    })
    const found = await checkApp(app)
    const errors = found.filter((one) => one.category === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('possibly')
}, 60_000)

// 38.138 — A BRANCH-LOCAL VALUE NARROWS AS THE PAGE'S OWN DOES. Read by name, it lowered to a call
// on the name — a branch-local name is out of scope where the page's record is declared — and a
// call narrows nothing, so `{#if proposal}{proposal.x}` reported `proposal` possibly undefined at
// every depth.
const BRANCH_LOCAL = `<script>
import { reactive } from '@abide/abide'

type Proposal = { x: string; kind: 'draft' | 'sent' }
let open = reactive(true)
let other = reactive(true)
let rows = reactive<number[]>([])
</script>

{#if open}
    <script>
    let proposal = reactive<Proposal | undefined>(undefined)
    let status = reactive<{ kind: 'ok'; total: number } | { kind: 'failed'; reason: string }>({
        kind: 'ok',
        total: 1,
    })
    </script>
    {#if proposal}
        {#if other}<p>{proposal.x}</p>{/if}
        {#for row of rows}<p>{row}{proposal.x}</p>{/for}
    {/if}
    {#if !proposal}<p>none</p>{:else if proposal.kind === 'draft'}<p>{proposal.x}</p>{:else}<p>{proposal.kind}</p>{/if}
    {#if status.kind === 'ok'}<p>{status.total}</p>{:else}<p>{status.reason}</p>{/if}
{/if}
`

// THE REVERT: lower a branch-local read to `name()` where the checker is asked, as before; every
// read under a guard is checked unnarrowed and this reports 7 errors where 0 are due.
test('a branch-local value narrows under a nested {#if}, an {:else if} and a {#for} — 38.138', async () => {
    const app = appFixture({ 'index.abide': BRANCH_LOCAL })
    const found = await checkApp(app)
    const errors = found.filter((one) => one.category === 'error')
    expect(errors.map((one) => one.message)).toEqual([])
}, 60_000)

// AND NOTHING WIDER: outside the guard, after a write that undoes it, and in a listener — run after
// the value may have changed, as a page's own is — it is still the union.
// THE REVERT: write a branch-local value through `set` while its reads go through the record; the
// write undoes no narrowing, the read after it checks clean, and this reports 2 errors where 3 are due.
test('a branch-local value is not narrowed outside its guard, nor past a write — 38.138', async () => {
    const app = appFixture({
        'index.abide': `<script>
import { reactive } from '@abide/abide'

let open = reactive(true)
</script>

{#if open}
    <script>
    let proposal = reactive<{ x: string } | undefined>(undefined)
    </script>
    {#if proposal}<p>{proposal.x}</p>{/if}<p>{proposal.x}</p>
    <button onclick={() => { if (proposal) { proposal = undefined; proposal.x } }}>x</button>
    {#if proposal}<button onclick={() => proposal.x}>x</button>{/if}
{/if}
`,
    })
    const found = await checkApp(app)
    const errors = found.filter((one) => one.category === 'error')
    expect(errors.map((one) => one.message)).toEqual([
        "'proposal' is possibly 'undefined'.",
        "'proposal' is possibly 'undefined'.",
        "'proposal' is possibly 'undefined'.",
    ])
}, 60_000)
