// 14.14 — A BODY SUSPENDS AT THE END OF WHAT IT AWAITS, not at the keyword. `id` in
// `await find(id)` is evaluated before the suspension and tracks; `two` in
// `(await find(one)) + two` is evaluated after it and does not. And a `for await` suspends once its
// iterable is evaluated, so `three` in its head tracks and `name` in its body does not.
//
// THE REVERT: push `node.getStart()` for each `await` in `awaitsIn` again, as it did. Every read in
// an awaited operand then warns too — `one` and `three` join the two due (4 against 2).

import { afterAll, expect, test } from 'bun:test'
import { compileApp } from '#compiler/compileApp.ts'
import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const PAGE = `<script>
import { reactive } from '@abide/abide'

let one = reactive(1)
let two = reactive(2)
let three = reactive([3])
let name = reactive('ada')
const find = async (id: number) => id
async function* each(list: number[]) {
    yield* list
}
const operand = reactive(async () => (await find(one)) + two)
const looped = reactive(async () => {
    for await (const item of each(three)) return item + name
    return 0
})
</script>

<p>{operand}{looped}</p>`

afterAll(removeTemporaryModules)

test('a read inside what is awaited tracks, and one after it warns — 14.14', async () => {
    const compiled = await compileApp(
        appFixture({ 'ui/pages/page.abide': PAGE }),
    )
    const warned: string[] = []
    for (const warning of compiled.warnings) {
        if (!warning.message.includes('14.14')) continue
        const line = PAGE.split('\n')[warning.line - 1] as string
        warned.push(line.slice(warning.column - 1).split(/\W/)[0] as string)
    }
    expect(warned).toEqual(['two', 'name'])
}, 60_000)
