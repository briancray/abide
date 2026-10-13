import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs' // bun has no sync mkdtemp/symlink/rm of its own
import { tmpdir } from 'node:os' // bun exposes no temp-directory helper of its own
import { compileApp } from '#compiler/compileApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

// 32.17 — A COMPONENT IS A PATH, NOT A FILE NAME. Two `Row.abide` in two directories are two
// components, and only the one a page imports is mounted into a row the browser built — so only
// that one carries a second copy of its template (`selfFill`). Read by name, the unimported one
// ships the copy too: the output is still right and the client is bigger, which is why the gate
// reads the module rather than the page.
//
// THE REVERT: key `selfFill` on the file name (`invoked` holding `Row.abide` rather than a path)
// and `ui/b/Row.abide`'s browser module carries `fillEmpty` — 1 module with a template copy it
// cannot use, against 0.
const SAME_NAMES = {
    'package.json': JSON.stringify({
        name: 'same-name-fixture',
        type: 'module',
        imports: { '#src/*': './*' },
    }),
    'page.abide': `<script>\nimport Row from '#src/ui/a/Row.abide'\n</script>\n\n<main><Row label="one"/></main>`,
    'ui/a/Row.abide': `<script>\nimport { reactive } from '@abide/abide'\n\nlet n = reactive(0)\n</script>\n\n<button onclick={() => { n = n + 1 }}>{n}</button>`,
    'ui/b/Row.abide': `<script>\nimport { reactive } from '@abide/abide'\n\nlet n = reactive(0)\n</script>\n\n<button onclick={() => { n = n + 1 }}>{n}</button>`,
}

test('two components with one file name are told apart by path — 32.17', async () => {
    const { files } = await compileApp(temporaryModule(SAME_NAMES))

    // 34.14 — the seam specifier stays as written, asking for the module the file compiles to.
    expect(files['page.abide']?.server).toContain(
        `import Row from '#src/ui/a/Row.abide?component'`,
    )
    expect(files['page.abide']?.client).toContain(
        `import Row from '#src/ui/a/Row.abide?component'`,
    )
    expect(files['ui/a/Row.abide']?.client).toContain('fillEmpty')
    expect(files['ui/b/Row.abide']?.client).not.toContain('fillEmpty')
})

// A ROOT SPELLED THROUGH A LINK IS THE SAME APP. `Bun.resolveSync` answers the path with the links
// taken out, so a walk listing the root as spelled finds no import landing on any file it listed.
// THE REVERT: drop `realpathSync` from `sourcesUnder` and `ui/a/Row` loses its template copy: 0
// components linked, against 1.
test('an app compiled through a symlinked root links its components — 32.17', async () => {
    const outside = mkdtempSync(`${tmpdir()}/abide-link-`)
    try {
        const link = `${outside}/app`
        symlinkSync(temporaryModule(SAME_NAMES), link)
        const { files } = await compileApp(link)
        expect(files['ui/a/Row.abide']?.client).toContain('fillEmpty')
    } finally {
        rmSync(outside, { recursive: true, force: true })
    }
})

// 23.3 — A ROUTE IS A FILE NAMED `page.abide`, not one whose name ENDS with it, and every other
// `.abide` is the app's own: a colocated `homepage.abide` read as a page is a second
// route at its directory's address, and a `sidebarlayout.abide` read as a layout wraps every page
// below it.
//
// THE REVERT: test `name.endsWith('page.abide')` / `'layout.abide'` in `fileKind`; this reads 2
// routes at `/blog`, against 1, and a layout around it.
test('a file whose name only ends with page.abide is a component — 23.3, 23.16', async () => {
    const { routes } = await compileApp(
        temporaryModule({
            'package.json': JSON.stringify({
                name: 'basename-fixture',
                type: 'module',
                imports: { '#src/*': './*' },
            }),
            'blog/page.abide': `<p>blog</p>`,
            'blog/homepage.abide': `<p>home</p>`,
            'blog/sidebarlayout.abide': `<aside>side</aside>`,
        }),
    )
    const blog = routes.filter((route) => route.pattern === '/blog')
    expect(blog).toHaveLength(1)
    expect(blog[0]?.layouts).toEqual([])
})

// 32.17 AND 38.65 IN ONE PROCESS — A COMPONENT CREATED SINCE THE LAST COMPILE IS INVOKED BY THE NEXT. `abide dev`
// compiles in one process for its whole session, and bun keeps a directory's listing for as long: a
// `#` specifier naming a file created since was not found, the page's import of it read as no
// component at all, and the browser bundle failed on the module nobody emitted. THE REVERT: drop the
// `throughImports` fallback in `resolveFrom`; the second compile emits no browser module for
// `ui/components/Second.abide`.
test('a component created between two compiles in one process is invoked — 32.17, 38.65', async () => {
    const app = temporaryModule({
        'package.json': JSON.stringify({
            name: 'created-fixture',
            type: 'module',
            imports: { '#src/*': './*' },
        }),
        'page.abide': `<script>\nimport First from '#src/ui/components/First.abide'\n</script>\n\n<First/>`,
        'ui/components/First.abide': '<p>first</p>',
    })
    const first = await compileApp(app)
    expect(first.files['ui/components/First.abide']?.client).not.toBe('')
    await Bun.write(`${app}/ui/components/Second.abide`, '<p>second</p>')
    await Bun.write(
        `${app}/page.abide`,
        `<script>\nimport First from '#src/ui/components/First.abide'\nimport Second from '#src/ui/components/Second.abide'\n</script>\n\n<First/>\n<Second/>`,
    )
    const second = await compileApp(app)
    expect(second.files['ui/components/Second.abide']?.client).not.toBe('')
})

// 34.15 — AN `import('…')` OF A `.abide` IS THE EDGE A STATIC IMPORT IS. The checker already
// pointed one at the checked module, and the build left it as written: the bundle shipped the
// component's SOURCE as an asset and handed the page its URL. Now both read one scan — and any
// other specifier, `../data.ts` here, stays as written (34.14).
//
// THE REVERT: drop the `dynamic` arm from `importSpans` and the page's modules keep
// `import('#src/ui/components/Card.abide')` bare — 0 of the 2 lanes asking for the compiled module,
// against 2.
test('a dynamic import of a .abide lands on its compiled module, in both lanes — 34.15', async () => {
    const { files } = await compileApp(
        temporaryModule({
            'package.json': JSON.stringify({
                name: 'dynamic-fixture',
                type: 'module',
                imports: { '#src/*': './*' },
            }),
            'page.abide': `<script>\nconst card = import('#src/ui/components/Card.abide')\nconst data = import('../data.ts')\n</script>\n\n<p>home</p>`,
            'data.ts': 'export const data = 1\n',
            'ui/components/Card.abide': `<p>card</p>`,
        }),
    )
    const page = files['page.abide']
    expect(page?.server).toContain(
        `import('#src/ui/components/Card.abide?component')`,
    )
    expect(page?.client).toContain(
        `import('#src/ui/components/Card.abide?component')`,
    )
    expect(page?.client).toContain(`import('../data.ts')`)
    expect(files['ui/components/Card.abide']?.client).not.toBe('')
})
