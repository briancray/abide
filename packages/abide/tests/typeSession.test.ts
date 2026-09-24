import { afterAll, expect, test } from 'bun:test'
import { rmSync, symlinkSync } from 'node:fs' // bun has no sync symlink/rm of its own
import { compileFile, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { render } from '#server'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'
import { namesRead } from './typed.ts'

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
<p>{rows}{count}{fromHelper}{step}{aliased}</p>`)

    const names = namesRead(file, await session.reads(PAGE, file))
    expect(names).toEqual(['count', 'fromHelper', 'rows'])
})

// 19.12 — where inference fails the compiler reads rather than refuses. An unresolved import is
// the commonest way for that to happen, and it must not take the file down with it.
test('an unresolved name is not reactive and does not refuse the file', async () => {
    const file = parseAbide(`<script>
import { mystery } from './nowhere.ts'
const value = mystery()
</script>
<p>{value}</p>`)
    expect(namesRead(file, await session.reads(PAGE, file))).toEqual([])
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
    const names = await session.reads(PAGE, file)
    expect(namesRead(file, names)).toEqual(['count'])

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
    expect(out).toContain('<h1>5</h1>')
    expect(out).toContain('<p>10</p>')
})

// 31.1 OVER AN IMPORT, END TO END: the page declares nothing reactive of its own, and the value it
// renders is a `Reactive` another module exports. THE REVERT: collect only the declared names in
// `TypeSession.readsFor`; the slot then renders a field of the `Reactive` object rather than of its
// value — `<p></p>` where `<p>hello</p>` is due, and nothing refuses.
test('a page reads a Reactive it imports and renders its value', async () => {
    const source = `<script>
import { onboarding } from '${ROOT}src/conversations.ts'
</script>

<p>{onboarding.text}</p>`

    const file = parseAbide(source)
    const names = await session.reads(PAGE, file)
    expect(namesRead(file, names)).toEqual(['onboarding'])

    const module = `${temporaryModule({ 'Page.ts': compileFile(source, names) })}/Page.ts`
    const { default: Page } = await import(module)
    let out = ''
    for await (const chunk of render(
        Page,
        '<!doctype html><html><head></head><body></body></html>',
    ))
        out += new TextDecoder().decode(chunk)
    expect(out).toContain('<p>hello</p>')
})

// 31.3 — AN UN-ANNOTATED BINDING OF A REACTIVE NAME HOLDS ITS VALUE, and the name it binds is not a
// `Reactive`. The lowering reads `a` in `let b = a`, so `b` is handed 1 — while the checker, asked
// of the shadow, infers `b` as the `Reactive` `a` is there. Both answers have to be the same one, and
// a declared name and an imported one are the same case. THE REVERT: drop `dropValueHolders` from
// `TypeSession.readsFor`; `b`, `c` and `greeting` are then read as `b()`, `c()` and `greeting()` —
// a call on 1 and on `{ text: 'hello' }` — and the render throws `b is not a function`. The
// annotated `held` is 31.3's own hold, and stays a `Reactive` either way.
test('a binding of a reactive name holds its value, declared or imported — 31.3', async () => {
    const source = `<script>
import { reactive } from 'abide'
import { onboarding } from '${ROOT}src/conversations.ts'
let a = reactive(1)
let b = a
let c = (b)
let greeting = onboarding
const held: import('abide').Reactive<number> = a
</script>

<p>{b}|{c}|{greeting.text}|{held}</p>`

    const file = parseAbide(source)
    const names = await session.reads(PAGE, file)
    expect(namesRead(file, names)).toEqual(['a', 'held', 'onboarding'])

    const module = `${temporaryModule({ 'Page.ts': compileFile(source, names) })}/Page.ts`
    const { default: Page } = await import(module)
    let out = ''
    for await (const chunk of render(
        Page,
        '<!doctype html><html><head></head><body></body></html>',
    ))
        out += new TextDecoder().decode(chunk)
    expect(out).toContain('<p>1|1|hello|1</p>')
})

// Two files through one session, at the same shadow path. THE REVERT: drop `fileChanges` from
// the `updateSnapshot` call in `TypeSession`; the second query then answers about the FIRST
// file's text at the second file's offsets and reports `['b']` where `['a']` is due — the names
// are real names and the types are real types, so nothing about the answer looks wrong.
test('a second file in the same session is not answered from the first', async () => {
    const first = parseAbide(
        `<script>\nimport { reactive } from 'abide'\nconst a = reactive(1)\nconst b = 2\n</script><p>{a}</p>`,
    )
    expect(namesRead(first, await session.reads(PAGE, first))).toEqual(['a'])

    const second = parseAbide(
        `<script>\nimport { reactive } from 'abide'\nconst a = 1\nconst b = reactive(2)\n</script><p>{b}</p>`,
    )
    expect(namesRead(second, await session.reads(PAGE, second))).toEqual(['b'])
})

// COMPILE TIME IS A SNAPSHOT COUNT, and asserting it as one is what makes the claim survive a
// loaded machine. Adding a file to the project's ROOT SET is what costs — 19.7 ms against 0.8 ms
// for a file it already has — so a build that takes a snapshot per file pays that on every file
// it has. THE REVERT: have `readsFor` loop over `reads`; the answers are
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

        const answers = await batch.readsFor(sources)
        expect(batch.snapshots).toBe(1)
        expect(answers).toHaveLength(12)
        // And every answer is the one the per-file path would have given.
        for (let at = 0; at < 12; at += 1)
            expect(
                namesRead(
                    (sources[at] as (typeof sources)[number]).file,
                    answers[at] ?? [],
                ),
            ).toEqual([`v${at}`])
    } finally {
        batch.close()
    }
})

const PROBE = `<script>
import { reactive } from 'abide'
let rows = reactive([1])
</script>
<p>{rows}</p>`

// A DANGLING SYMLINK IS NOT A CRASH. The listing was walked with a `statSync` per entry, which
// FOLLOWS a symlink — so an Emacs `.#page.abide` lock file beside a page threw ENOENT out of a
// directory listing and took the whole build down with it, from a name the compiler was only
// counting. THE REVERT: `statSync(join(directory, entry)).isDirectory()` over a plain
// `readdirSync(directory)`; this test then reports `ENOENT` where 1 typed name is due, and it is
// N syscalls for an answer the listing already carried.
test('a dangling symlink beside a page does not take the build down', async () => {
    const dir = temporaryModule({
        'tsconfig.json': JSON.stringify({
            compilerOptions: {
                strict: true,
                target: 'esnext',
                module: 'preserve',
                moduleResolution: 'bundler',
                allowImportingTsExtensions: true,
                types: [],
            },
            include: ['.'],
        }),
    })
    symlinkSync(`${dir}/nothing-is-here.ts`, `${dir}/.#page.abide`)
    const local = await TypeSession.open(`${dir}/tsconfig.json`)
    try {
        const probe = parseAbide(PROBE)
        const names = await local.reads(`${dir}/page.abide`, probe)
        expect(namesRead(probe, names)).toEqual(['rows'])
    } finally {
        local.close()
        rmSync(`${dir}/.#page.abide`, { force: true })
    }
})

// TWO PATHS TO ONE DIRECTORY ARE ONE DIRECTORY, and the place to settle that is the KEY rather
// than the comparison: the shadow was registered under the path as it arrived, so a doubled
// separator made it invisible to its own directory listing AND named a file the checker could not
// open. THE REVERT: key the shadow on `${source.path}.shadow.ts`; this test then reports
// `is not inside the project` where 1 typed name is due, with the app's tsconfig blamed for a
// path this class had mangled.
test('a page path with a doubled separator still finds its shadow', async () => {
    const probe = parseAbide(PROBE)
    const names = await session.reads(`${ROOT}src//doubled.abide`, probe)
    expect(namesRead(probe, names)).toEqual(['rows'])
})

// 31.3 — A `Reactive` IS TOLD BY ITS DECLARATION, so a name for it the app made up is still one, and
// a type of the app's own that merely prints as `Reactive<…>` is not — and neither is an array of
// them, which a name is read as. THE REVERT: decide by `typeToString(type).startsWith('Reactive<')`;
// `counter` and `maybe` then print as `Counter` and are missed, `list` prints as `Reactive<…>[]` and
// is taken for one, and so is the page's own `Reactive` — 4 wrong names out of 8. `signal` and
// `tagged` pass either way: a renamed import prints under its declared name, and an intersection
// prints its `Reactive` first.
test('a Reactive under an alias or another name is reactive, and a lookalike is not', async () => {
    const file = parseAbide(`<script>
import { reactive, type Reactive } from 'abide'
import type { Signal } from './Signal.ts'

type Counter = Reactive<number>
const counter: Counter = reactive(0)
const maybe: Counter | undefined = reactive(1)
const signal: Signal<number> = reactive(2)
const direct = reactive(3)
const tagged = Object.assign(reactive(4), { tag: 'x' })
const list = [reactive(5)]
</script>
<p>{counter}{maybe}{signal}{direct}{tagged}{list.length}</p>`)
    expect(namesRead(file, await session.reads(PAGE, file))).toEqual([
        'counter',
        'direct',
        'maybe',
        'signal',
        'tagged',
    ])

    const lookalike = parseAbide(`<script>
type Reactive<Value> = { (): Value; label: string }
declare function own(): Reactive<number>
const mine = own()
</script>
<p>{mine}</p>`)
    expect(namesRead(lookalike, await session.reads(PAGE, lookalike))).toEqual(
        [],
    )
})

// 33 — `props()` IS ABIDE'S BY ITS CALLEE, not its spelling. An app's own function of that name is an
// ordinary call and renders what it returns. THE REVERT: drop the callee check in `propsReads`; 1
// `props` splice comes back where 0 are due, and the page lowers the call to `__props` and throws
// `label is not a function` rather than rendering `mine`.
test("an app's own function named props is not compiled away", async () => {
    const source = `<script>
function props() {
    return { label: 'mine' }
}
const { label } = props()
</script>
<p>{label}</p>`
    const file = parseAbide(source)
    const reads = await session.reads(PAGE, file)
    expect(reads.filter((read) => read.shape === 'props')).toEqual([])

    const module = `${temporaryModule({ 'Page.ts': compileFile(source, reads) })}/Page.ts`
    const { default: Page } = await import(module)
    let out = ''
    for await (const chunk of render(
        Page,
        '<!doctype html><html><head></head><body></body></html>',
    ))
        out += new TextDecoder().decode(chunk)
    expect(out).toContain('<p>mine</p>')
})
