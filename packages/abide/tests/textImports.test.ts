// 34.21 — A `.abide` IMPORTED `with { type: 'text' }` IS ITS TEXT, as any other file imported so is
// in bun: on the server, in the browser's bundle, and to the checker, which types it a `string`.

import { afterAll, expect, test } from 'bun:test'

import { checkApp } from '#compiler/checkApp.ts'
import { compilationOf, compileApp } from '#compiler/compileApp.ts'
import { serveCompilation } from '#server/abideModules.ts'
import { buildDirectory, buildFiles } from '#server/appBuild.ts'
import { COMPONENT_QUERY, TEXT_SUFFIX } from '#server/MODULE_QUERIES.ts'

import { serveApp } from './builtApp.ts'
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
        'app/src/demo/lib/Counter.abide': COUNTER,
        'app/src/demo/lib/data.ts': 'export const rows = [1, 2]\n',
        'app/src/demo/index.abide': `<script>
import Counter from './lib/Counter.abide'
import source from './lib/Counter.abide' with { type: 'text' }
import data from './lib/data.ts' with { type: 'text' }
${use}
</script>

<main><Counter/><pre>{source}</pre></main>
`,
    })}/app/src`
}

// THE REVERT: write the block as it stands in `projectShadow`'s `script`; both modules import the
// compiled component, and `source` is a function — and `data` the module, through the fence. Served,
// `TEXT_SUFFIX` is the file's text (`abideModules`), and the module and the text are two modules.
test('a .abide imported as text is its text on both sides — 34.21', async () => {
    const root = app('')
    const compiled = await compileApp(root)
    const { files } = compiled
    const page = files['demo/index.abide']
    for (const lane of [page?.server, page?.client]) {
        expect(lane).toContain(
            `import source from './lib/Counter.abide${TEXT_SUFFIX}'\n`,
        )
        // Any other file too: the plugin answers the text, so the browser's fence never sees it.
        expect(lane).toContain(
            `import data from './lib/data.ts${TEXT_SUFFIX}'\n`,
        )
    }
    serveCompilation(root, compilationOf(compiled))
    const served = await import(`${root}/demo/lib/Counter.abide${TEXT_SUFFIX}`)
    expect(served.default).toBe(COUNTER)
    const component = await import(
        `${root}/demo/lib/Counter.abide${COMPONENT_QUERY}`
    )
    expect(typeof component.default).toBe('function')
}, 30_000)

test('the checker types a .abide imported as text a string — 34.21', async () => {
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

// A FILE WITH NO EXTENSION — a `Dockerfile`, a `LICENSE`, a `Makefile` — is text like any other:
// bun's runtime asks no plugin's `onResolve` of a specifier whose last segment has no extension, so
// a face spelled as a query alone (`./Dockerfile?text`) was loaded as JavaScript, and the page
// answered 500. THE REVERT: `TEXT_SUFFIX` back to `'?text'` — the runtime's import throws
// `Expected ";"` and `abide start` answers 500.
const EXTENSIONLESS = {
    Dockerfile: 'FROM oven/bun:1\nCMD ["bun", "start"]\n',
    LICENSE: 'MIT License\n',
    Makefile: 'all:\n\tbun run build\n',
}

function extensionless(): Record<string, string> {
    const files: Record<string, string> = {
        'index.abide': `<script>
import { reactive } from '@abide/abide'
${Object.keys(EXTENSIONLESS)
    .map((name) => `import ${name} from './lib/${name}' with { type: 'text' }`)
    .join('\n')}

let shown = reactive(Dockerfile)
</script>

<button onclick={() => shown = LICENSE + Makefile}>swap</button>
<pre>{shown}{LICENSE}{Makefile}</pre>
`,
    }
    for (const [name, text] of Object.entries(EXTENSIONLESS))
        files[`lib/${name}`] = text
    return files
}

test('a file with no extension imported as text is its text to the runtime — 34.21', async () => {
    const root = temporaryModule({
        'package.json': JSON.stringify({ name: 'texts', type: 'module' }),
        ...extensionless(),
    })
    serveCompilation(root, compilationOf(await compileApp(root)))
    for (const [name, text] of Object.entries(EXTENSIONLESS)) {
        const served = await import(`${root}/lib/${name}${TEXT_SUFFIX}`)
        expect(served.default).toBe(text)
    }
    const page = await import(`${root}/index.abide${COMPONENT_QUERY}`)
    expect(typeof page.default).toBe('function')
}, 30_000)

test('a file with no extension imported as text is its text built, started and bundled — 34.21', async () => {
    const { app, base, stop } = await serveApp(extensionless())
    try {
        const response = await fetch(`${base}/`)
        expect(response.status).toBe(200)
        const body = await response.text()
        for (const text of Object.values(EXTENSIONLESS))
            expect(body).toContain(text)
        const { client } = buildFiles(buildDirectory(app))
        let bundled = ''
        for (const chunk of new Bun.Glob('*.js').scanSync(client))
            bundled += await Bun.file(`${client}/${chunk}`).text()
        // Each file's first line: the minifier quotes a string as it likes.
        for (const text of Object.values(EXTENSIONLESS))
            expect(bundled).toContain(text.split('\n')[0] as string)
    } finally {
        stop()
    }
}, 60_000)
