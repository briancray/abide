// 38.3 — AN ARM IS CHECKED UNDER WHAT ITS CONDITION ESTABLISHED. `{#if}` is projected as the `if` it
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
