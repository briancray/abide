import { afterAll, expect, test } from 'bun:test'
import { compileFile, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { render } from '#server'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const TSCONFIG = `${ROOT}tsconfig.json`
const PAGE = `${ROOT}src/page.abide`

const session = await TypeSession.open(TSCONFIG)
afterAll(() => session.close())

// 31.3's answer comes from the checker, and the un-annotated binding is the case that decides it:
// `let rows = reactive([...])` is what the corpus writes, and only an INFERRED type answers it.
// THE REVERT: decide by looking for the literal text `reactive(` in the script instead. `aliased`
// then reads as reactive where it is not — 1 wrong name where 0 are due — and `fromHelper` is
// missed, which is 1 more.
test('a reactive name is told from an ordinary one by its type', async () => {
    const file = parseAbide(`<script>
import { reactive } from 'abide'

declare function makeCount(): import('abide').Reactive<number>

let rows = reactive([{ id: 'ada' }])
const count: import('abide').Reactive<number> = reactive(0)
const fromHelper = makeCount()
const step = 1
const aliased = 'reactive(0)'
</script>
<p>{rows}</p>`)

    const names = await session.reactiveNames(PAGE, file)
    expect([...names].sort()).toEqual(['count', 'fromHelper', 'rows'])
    expect(names.has('step')).toBe(false)
    expect(names.has('aliased')).toBe(false)
})

// 19.12 — where inference fails the compiler reads rather than refuses. An unresolved import is
// the commonest way for that to happen, and it must not take the file down with it.
test('an unresolved name is not reactive and does not refuse the file', async () => {
    const file = parseAbide(`<script>
import { mystery } from './nowhere.ts'
const value = mystery()
</script>
<p>{value}</p>`)
    const names = await session.reactiveNames(PAGE, file)
    expect(names.has('value')).toBe(false)
})

afterAll(removeTemporaryModules)

// The whole of stage 2 in one case: the checker decides which names are reactive, the lowering
// rewrites reads and writes by name, the imports hoist, and the document that comes out carries
// the value the write produced. THE REVERT: pass an empty set to `compileFile`; the emitted
// module then has `count` where `count()` is due and renders `[object Object]` twice rather than
// `5` and `10` — 2 wrong slots, and the write silently rebinds the name instead of setting it.
test('a page reads and writes a reactive name and renders the result', async () => {
    const source = `<script>
import { reactive } from 'abide'

let count = reactive(2)
const step = 3
count = count + step
</script>

<head><title>count is {count}</title></head>
<h1>{count}</h1>
<p>{count * 2}</p>`

    const file = parseAbide(source)
    const names = await session.reactiveNames(PAGE, file)
    expect([...names]).toEqual(['count'])

    const module = `${temporaryModule({ 'Page.ts': compileFile(source, names) })}/Page.ts`

    const { default: Page } = await import(module)
    let out = ''
    for await (const chunk of render(
        Page,
        '<!doctype html><html><head></head><body></body></html>',
    ))
        out += new TextDecoder().decode(chunk)

    // 2 + 3 = 5, so the write went through `set` rather than rebinding the name.
    expect(out).toContain('<title>count is 5</title>')
    expect(out).toContain('<h1><!--a0-->5<!--/a--></h1>')
    expect(out).toContain('<p><!--a1-->10<!--/a--></p>')
})

// Two files through one session, at the same shadow path. THE REVERT: drop `fileChanges` from
// the `updateSnapshot` call in `TypeSession`; the second query then answers about the FIRST
// file's text at the second file's offsets and reports `['b']` where `['a']` is due — the names
// are real names and the types are real types, so nothing about the answer looks wrong.
test('a second file in the same session is not answered from the first', async () => {
    const first = parseAbide(
        `<script>\nimport { reactive } from 'abide'\nconst a = reactive(1)\nconst b = 2\n</script><p>{a}</p>`,
    )
    expect([...(await session.reactiveNames(PAGE, first))]).toEqual(['a'])

    const second = parseAbide(
        `<script>\nimport { reactive } from 'abide'\nconst a = 1\nconst b = reactive(2)\n</script><p>{b}</p>`,
    )
    expect([...(await session.reactiveNames(PAGE, second))]).toEqual(['b'])
})

// COMPILE TIME IS A SNAPSHOT COUNT, and asserting it as one is what makes the claim survive a
// loaded machine. Adding a file to the project's ROOT SET is what costs — 19.7 ms against 0.8 ms
// for a file it already has — so a build that takes a snapshot per file pays that on every file
// it has. THE REVERT: have `reactiveNamesFor` loop over `reactiveNames`; the answers are
// identical and this reports 12 snapshots where 1 is due, which is ~19 ms a file rather than
// ~0.8 ms and is 99.8% of the time a build spends.
test('a whole build takes ONE snapshot, not one per file', async () => {
    const batch = await TypeSession.open(TSCONFIG)
    try {
        const sources = []
        for (let at = 0; at < 12; at += 1)
            sources.push({
                path: `${ROOT}src/batch-${at}.abide`,
                file: parseAbide(
                    `<script>\nimport { reactive } from 'abide'\nconst v${at} = reactive(${at})\nconst plain${at} = ${at}\n</script><p>{v${at}}</p>`,
                ),
            })

        const answers = await batch.reactiveNamesFor(sources)
        expect(batch.snapshots).toBe(1)
        expect(answers).toHaveLength(12)
        // And every answer is the one the per-file path would have given.
        for (let at = 0; at < 12; at += 1)
            expect([...(answers[at] as Set<string>)]).toEqual([`v${at}`])
    } finally {
        batch.close()
    }
})
