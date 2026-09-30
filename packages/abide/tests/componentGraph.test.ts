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
// and `ui/b/Row.client.ts` carries `fillRegion` — 1 module with a template copy it cannot use,
// against 0.
const SAME_NAMES = {
    'package.json': JSON.stringify({
        name: 'same-name-fixture',
        type: 'module',
        imports: { '#ui/*': './ui/*' },
    }),
    'ui/app.html': `<!doctype html><html><head></head><body></body></html>`,
    'ui/pages/page.abide': `<script>\nimport Row from '#ui/a/Row.abide'\n</script>\n\n<main><Row label="one"/></main>`,
    'ui/a/Row.abide': `<script>\nimport { reactive } from 'abide'\n\nlet n = reactive(0)\n</script>\n\n<button onclick={() => { n = n + 1 }}>{n}</button>`,
    'ui/b/Row.abide': `<script>\nimport { reactive } from 'abide'\n\nlet n = reactive(0)\n</script>\n\n<button onclick={() => { n = n + 1 }}>{n}</button>`,
}

test('two components with one file name are told apart by path — 32.17', async () => {
    const { modules } = await compileApp(temporaryModule(SAME_NAMES))

    // The seam specifier lands in the output tree, in both lanes.
    expect(modules.get('ui/pages/page.ts')).toContain(
        `import Row from '../a/Row.ts'`,
    )
    expect(modules.get('ui/pages/page.client.ts')).toContain(
        `import Row from '../a/Row.client.ts'`,
    )
    expect(modules.get('ui/a/Row.client.ts')).toContain('fillRegion')
    expect(modules.get('ui/b/Row.client.ts')).not.toContain('fillRegion')
})

// A ROOT SPELLED THROUGH A LINK IS THE SAME APP. `Bun.resolveSync` answers the path with the links
// taken out, so a walk listing the root as spelled finds no import landing on any file it listed.
// THE REVERT: drop `realpathSync` from `compileApp` and the page imports `#ui/a/Row.ts` — a module
// that exists nowhere — and `ui/a/Row` loses its template copy: 0 components linked, against 1.
test('an app compiled through a symlinked root links its components — 32.17', async () => {
    const outside = mkdtempSync(`${tmpdir()}/abide-link-`)
    try {
        const link = `${outside}/app`
        symlinkSync(temporaryModule(SAME_NAMES), link)
        const { modules } = await compileApp(link)
        expect(modules.get('ui/pages/page.client.ts')).toContain(
            `import Row from '../a/Row.client.ts'`,
        )
        expect(modules.get('ui/a/Row.client.ts')).toContain('fillRegion')
    } finally {
        rmSync(outside, { recursive: true, force: true })
    }
})

// 23.3 — A ROUTE IS A FILE NAMED `page.abide`, not one whose name ENDS with it. A colocated
// `homepage.abide` read as a page is a second route at its directory's address, and a
// `sidebarlayout.abide` read as a layout wraps every page below it.
//
// THE REVERT: test `relative.endsWith('page.abide')` / `'layout.abide'` in `fileKind` and this
// reads 2 routes at `/blog`, against 1.
test('a file whose name only ends with page.abide is a component — 23.3', async () => {
    const { routes } = await compileApp(
        temporaryModule({
            'package.json': JSON.stringify({
                name: 'basename-fixture',
                type: 'module',
                imports: { '#ui/*': './ui/*' },
            }),
            'ui/app.html': `<!doctype html><html><head></head><body></body></html>`,
            'ui/pages/blog/page.abide': `<p>blog</p>`,
            'ui/pages/blog/homepage.abide': `<p>home</p>`,
            'ui/pages/blog/sidebarlayout.abide': `<aside>side</aside>`,
        }),
    )
    const blog = routes.filter((route) => route.pattern === '/blog')
    expect(blog).toHaveLength(1)
    expect(blog[0]?.layouts).toEqual([])
})
