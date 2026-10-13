// 34.25 — A `.abide` IMPORTED `with { type: 'text' }` IS ITS TEXT, as any other file imported so is
// in bun: on the server, in the browser's bundle, and to the checker, which types it a `string`.

import { afterAll, expect, test } from 'bun:test'
import { checkApp } from '#compiler/checkApp.ts'
import { compileApp } from '#compiler/compileApp.ts'
import { serveCompilation } from '#server/abideModules.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

const COUNTER = `<script>
import { reactive } from '@abide/abide'

let count = reactive(1)
</script>

<button onclick={() => count = count + 1}>{count}</button>
`

function app(use: string): string {
    return `${temporaryModule({
        'app/package.json': JSON.stringify({ name: 'texts', type: 'module' }),
        'app/src/demo/Counter.abide': COUNTER,
        'app/src/demo/data.ts': 'export const rows = [1, 2]\n',
        'app/src/demo/page.abide': `<script>
import Counter from './Counter.abide'
import source from './Counter.abide' with { type: 'text' }
import data from './data.ts' with { type: 'text' }
${use}
</script>

<main><Counter/><pre>{source}</pre></main>
`,
    })}/app/src`
}

// THE REVERT: write the block as it stands in `projectShadow`'s `script`; both modules import the
// compiled component, and `source` is a function — and `data` the module, through the fence. Served,
// `?text` is the file's text (`abideModules`), and the module and the text are two modules.
test('a .abide imported as text is its text on both sides — 34.25', async () => {
    const root = app('')
    const { files, tables } = await compileApp(root)
    const page = files['demo/page.abide']
    for (const lane of [page?.server, page?.client]) {
        expect(lane).toContain("import source from './Counter.abide?text'\n")
        // Any other file too: the plugin answers the text, so the browser's fence never sees it.
        expect(lane).toContain("import data from './data.ts?text'\n")
    }
    serveCompilation(root, { files, tables })
    const served = await import(`${root}/demo/Counter.abide?text`)
    expect(served.default).toBe(COUNTER)
    const component = await import(`${root}/demo/Counter.abide?component`)
    expect(typeof component.default).toBe('function')
}, 30_000)

test('the checker types a .abide imported as text a string — 34.25', async () => {
    const typed = await checkApp(app('const length: number = source.length'))
    expect(typed.filter((found) => found.category === 'error')).toEqual([])
    const mistyped = await checkApp(app('const wrong: number = data'))
    expect(
        mistyped.some(
            (found) =>
                found.category === 'error' &&
                found.message.includes("'string' is not assignable"),
        ),
    ).toBe(true)
}, 30_000)
