// 14.2, 14.8 — THE PROJECTION'S POSITION TABLE: every expression the template holds, recorded with
// its kind where the projection writes it, so the readers of the checker's tree ask the table what a
// node is rather than re-recognizing the scaffolding around it.

import { afterAll, expect, test } from 'bun:test'
import { parseAbide } from '#compiler'
import type { PositionKind } from '#compiler/PositionTable.ts'
import { projectShadow } from '#compiler/projectShadow.ts'
import { TypeSession } from '#compiler/TypeSession.ts'
import { closeTyped } from './typed.ts'

afterAll(closeTyped)

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)
afterAll(() => session.close())

// One source per kind, as the projection copies it. A `Record` so a kind added to `PositionKind`
// does not compile until it is written here too.
const WRITTEN: Record<PositionKind, string> = {
    slot: 'shown',
    attribute: 'tone',
    condition: 'ready',
    subject: 'rows',
    key: 'row.id',
    listener: 'press',
    prop: 'label',
    elementBind: 'typed',
    componentBind: 'held',
    untyped: 'stray',
    setup: '\nconst local = 1\n',
    head: 'const { name } = __inlineProps<typeof __record>()',
    tag: 'Child',
}

const EVERY_KIND = `<script>
let shown = 1, tone = '', ready = true, rows = [{ id: 1 }], press = () => {}, label = '', typed = '', held = '', stray = 0
</script>
{#component Named({ name })}<b>{name}</b>{/component}
<p class={tone} onclick={press}>{shown}</p>
<input bind:value={typed}>
{#if ready}<script>
const local = 1
</script>{/if}
{#for row of rows by row.id}<i></i>{/for}
<Child label={label} bind:value={held} class:x={stray}/>`

// A SCAFFOLDING CHANGE CANNOT DROP A KIND: each one is in the table, over the source it was written
// from, and the table is ascending. THE REVERT: record a `{#for}` key with the expression scaffold
// but no kind (`copied` in place of `expression`); `key` is missing (12 kinds against 13).
test('every position kind is in the table, over what was written — 14.2', () => {
    const projection = projectShadow(parseAbide(EVERY_KIND))
    const seen = new Map<PositionKind, string>()
    let previous = -1
    for (const position of projection.positions.all) {
        expect(position.start).toBeGreaterThan(previous)
        previous = position.start
        seen.set(
            position.kind,
            projection.text.slice(position.start, position.end),
        )
    }
    expect(Object.fromEntries(seen)).toEqual(WRITTEN)
})

async function deferred(source: string): Promise<number[]> {
    const { warnings } = await session.readsFor([
        {
            path: `${ROOT}src/positions.abide`,
            file: parseAbide(source),
            text: source,
        },
    ])
    return warnings
        .filter((warning) => warning.message.includes('14.16'))
        .map(({ line }) => line)
}

// 14.2 REACHES AN INLINE COMPONENT'S BODY: its slot is a template position however deep the function
// it is projected as. THE REVERT: drop a position with a function between it and the file, as the
// scaffolding-reading walk did — the inline component's read goes unwarned (0 against 1).
test("a read an inline component's slot defers warns as a top-level one does — 14.16", async () => {
    expect(
        await deferred(`<script>
import { reactive } from '@abide/abide'

let one = reactive(1)
</script>
{#component Late()}<p>{setTimeout(() => one, 0)}</p>{/component}
<Late/>`),
    ).toEqual([6])
})

// 14.8 — A BRANCH-LOCAL `<script>` TRACKS NOTHING, even a statement in it that is parenthesized as a
// slot's scaffolding is. THE REVERT: add `setup` to `TRACKED`, which is what reading `;(…)` as a
// slot amounted to; the script's statement warns (1 against 0).
test("a parenthesized statement in an arm's script is no template position — 14.8", async () => {
    expect(
        await deferred(`<script>
import { reactive } from '@abide/abide'

let one = reactive(1)
</script>
{#if true}<script>
;(setTimeout(() => one, 0))
</script><b>x</b>{/if}`),
    ).toEqual([])
})

// 14.16 — A TRACKED BODY IS FOUND THROUGH A TYPE: `satisfies` wraps the function and changes
// nothing it runs, so the `reactive` it is handed to is still the body that tracks. THE REVERT:
// look past parentheses alone in `holderOf`; the body is not found and the read goes unwarned
// (0 against 1).
test('a reactive body wrapped in a type still tracks — 14.16', async () => {
    expect(
        await deferred(`<script>
import { reactive } from '@abide/abide'

let one = reactive(1)
const later = reactive((() => setTimeout(() => one, 0)) satisfies () => unknown)
</script>`),
    ).toEqual([5])
})
