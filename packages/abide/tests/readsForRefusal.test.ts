// A BATCH `readsFor` REFUSES, and the session it refused in goes on answering. `abide check` and
// `abide lsp` both ask for a batch and fall back to a file at a time when it throws, so what the
// refused batch left behind is what every later answer is read against.

import { afterAll, expect, test } from 'bun:test'
import { parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { namesRead, refusal } from './typed.ts'

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname

const session = await TypeSession.open(`${ROOT}tsconfig.json`)
afterAll(() => session.close())

// 31.3 — A SHADOW REGISTERED IS A SHADOW REPORTED, even when a later file in its batch refuses to
// project. The page's new text went into the session and the snapshot that would have been told
// never came, so the retry found nothing moved: the checker answered from the page's OLD shadow at
// the new one's offsets, and a page it had never seen was refused as outside the project for the
// rest of the session. THE REVERT: register each shadow in the loop that projects it; the seen page
// reads one name, `= 2\nl`, where `count` is due, and the unseen one is refused as not inside the
// project.
test('a batch refused by a later file leaves every earlier shadow reported', async () => {
    const seen = `${ROOT}src/batchSeen.abide`
    const unseen = `${ROOT}src/batchUnseen.abide`
    const refused = {
        path: `${ROOT}src/BatchAwaits.abide`,
        file: parseAbide(`<script>
await Promise.resolve()
</script>`),
    }
    const before = parseAbide(`<script>
import { reactive } from '@abide/abide'
let count = reactive(0)
</script>
<p>{count}</p>`)
    const after = parseAbide(`<script>
import { reactive } from '@abide/abide'
const step = 1
const other = 2
let count = reactive(0)
</script>
<p>{count + step + other}</p>`)
    expect(namesRead(before, await session.reads(seen, before))).toEqual([
        'count',
    ])

    expect(
        await refusal(
            session.readsFor([
                { path: seen, file: after },
                { path: unseen, file: after },
                refused,
            ]),
        ),
    ).toContain('await')

    expect(namesRead(after, await session.reads(seen, after))).toEqual([
        'count',
    ])
    expect(await refusal(session.reads(unseen, after))).toBe('')
}, 60_000)

// 33.14 — A PROPS PATTERN'S REFUSAL IS HANDLED WHERE IT IS STARTED. `propsReads` runs beside the
// file's other round trips and is awaited after them, so a nested pattern rejected while nothing
// was listening yet — an unhandled rejection that printed its stack and set the exit code, beside
// the clean refusal the caller made of it. `bun test` fails the test an unhandled rejection lands
// in, which is the assertion. THE REVERT: drop the `catch` beside `propsReads`'s start; the test
// fails on the 33.14 error, reported unhandled, before its refusal is read.
test('a nested props pattern is refused without an unhandled rejection', async () => {
    const file = parseAbide(`<script>
import { props, reactive } from '@abide/abide'
let count = reactive(0)
const step = 1
const { a: { b } } = props<{ a: { b: number } }>()
</script>
<p>{count + step + b}</p>`)
    expect(
        await refusal(session.reads(`${ROOT}src/NestedProps.abide`, file)),
    ).toContain('33.14')
}, 60_000)
