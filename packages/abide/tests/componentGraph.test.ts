import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs' // bun has no sync mkdtemp/symlink/rm of its own
import { tmpdir } from 'node:os' // bun exposes no temp-directory helper of its own

import { compileApp } from '#compiler/compileApp.ts'
import { isServerFile, placement, placeOf } from '#server/placement.ts'

import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'
import { refusal } from './typed.ts'

afterAll(removeTemporaryModules)

// 32.17 — A COMPONENT IS A PATH, NOT A FILE NAME. Two `Row.abide` in two directories are two
// components, and only the one a page imports is mounted into a row the browser built — so only
// that one carries a second copy of its template (`selfFill`). Read by name, the unimported one
// ships the copy too: the output is still right and the client is bigger, which is why the gate
// reads the module rather than the page.
//
// THE REVERT: key `selfFill` on the file name (`invoked` holding `Row.abide` rather than a path)
// and `lib/b/Row.abide`'s browser module carries `fillEmpty` — 1 module with a template copy it
// cannot use, against 0.
const SAME_NAMES = {
    'index.abide': `<script>\nimport Row from '#src/lib/a/Row.abide'\n</script>\n\n<main><Row label="one"/></main>`,
    'lib/a/Row.abide': `<script>\nimport { reactive } from '@abide/abide'\n\nlet n = reactive(0)\n</script>\n\n<button onclick={() => { n = n + 1 }}>{n}</button>`,
    'lib/b/Row.abide': `<script>\nimport { reactive } from '@abide/abide'\n\nlet n = reactive(0)\n</script>\n\n<button onclick={() => { n = n + 1 }}>{n}</button>`,
}

test('two components with one file name are told apart by path — 32.17', async () => {
    const { files } = await compileApp(appFixture(SAME_NAMES))

    // 34.14 — the seam specifier stays as written, asking for the module the file compiles to.
    expect(files['index.abide']?.server).toContain(
        `import Row from '#src/lib/a/Row.abide?component'`,
    )
    expect(files['index.abide']?.client).toContain(
        `import Row from '#src/lib/a/Row.abide?component'`,
    )
    expect(files['lib/a/Row.abide']?.client).toContain('fillEmpty')
    expect(files['lib/b/Row.abide']?.client).not.toContain('fillEmpty')
})

// A ROOT SPELLED THROUGH A LINK IS THE SAME APP. `Bun.resolveSync` answers the path with the links
// taken out, so a walk listing the root as spelled finds no import landing on any file it listed.
// THE REVERT: drop the `realpathSync` at the top of `compileApp` and `lib/a/Row` loses its template
// copy: 0 components linked, against 1.
test('an app compiled through a symlinked root links its components — 32.17', async () => {
    const outside = mkdtempSync(`${tmpdir()}/abide-link-`)
    try {
        const link = `${outside}/app`
        symlinkSync(appFixture(SAME_NAMES), link)
        const { files } = await compileApp(link)
        expect(files['lib/a/Row.abide']?.client).toContain('fillEmpty')
    } finally {
        rmSync(outside, { recursive: true, force: true })
    }
})

// 23.14, 23.21 — A LAYOUT IS A FILE NAMED `layout.abide`, not one whose name ENDS with it: a
// `sidebarlayout.abide` is a page at its own name like any other `.abide` in an address directory,
// and read as a layout it would wrap every page below it.
//
// THE REVERT: test `name.endsWith('layout.abide')` in `placement`; `/blog/sidebarlayout` is no
// route and `/blog` is wrapped in 1 layout, against 0.
test('a file whose name only ends with layout.abide is a page — 23.14, 23.21', async () => {
    const { routes } = await compileApp(
        appFixture({
            'blog/index.abide': `<p>blog</p>`,
            'blog/homepage.abide': `<p>home</p>`,
            'blog/sidebarlayout.abide': `<aside>side</aside>`,
        }),
    )
    const layouts: Record<string, string[]> = {}
    for (const route of routes) layouts[route.pattern] = route.layouts
    expect(layouts).toEqual({
        '/blog': [],
        '/blog/homepage': [],
        '/blog/sidebarlayout': [],
    })
})

// 32.17 AND 38.65 IN ONE PROCESS — A COMPONENT CREATED SINCE THE LAST COMPILE IS INVOKED BY THE NEXT. `abide dev`
// compiles in one process for its whole session, and bun keeps a directory's listing for as long: a
// `#` specifier naming a file created since was not found, the page's import of it read as no
// component at all, and the browser bundle failed on the module nobody emitted. THE REVERT: drop the
// `throughImports` fallback in `resolveFrom`; the second compile emits no browser module for
// `lib/Second.abide`.
test('a component created between two compiles in one process is invoked — 32.17, 38.65', async () => {
    const app = appFixture({
        'index.abide': `<script>\nimport First from '#src/lib/First.abide'\n</script>\n\n<First/>`,
        'lib/First.abide': '<p>first</p>',
    })
    const first = await compileApp(app)
    expect(first.files['lib/First.abide']?.client).toContain('first')
    await Bun.write(`${app}/lib/Second.abide`, '<p>second</p>')
    await Bun.write(
        `${app}/index.abide`,
        `<script>\nimport First from '#src/lib/First.abide'\nimport Second from '#src/lib/Second.abide'\n</script>\n\n<First/>\n<Second/>`,
    )
    const second = await compileApp(app)
    expect(second.files['lib/Second.abide']?.client).toContain('second')
})

// 34.15 — AN `import('…')` OF A `.abide` IS THE EDGE A STATIC IMPORT IS. The checker already
// pointed one at the checked module, and the build left it as written: the bundle shipped the
// component's SOURCE as an asset and handed the page its URL. Now both read one scan — and any
// other specifier, `./lib/data.ts` here, stays as written (34.14).
//
// THE REVERT: drop the `dynamic` arm from `importSpans` and the page's modules keep
// `import('#src/lib/Card.abide')` bare — 0 of the 2 lanes asking for the compiled module,
// against 2.
test('a dynamic import of a .abide lands on its compiled module, in both lanes — 34.15', async () => {
    const { files } = await compileApp(
        appFixture({
            'index.abide': `<script>\nconst card = import('#src/lib/Card.abide')\nconst data = import('./lib/data.ts')\n</script>\n\n<p>home</p>`,
            'lib/data.ts': 'export const data = 1\n',
            'lib/Card.abide': `<p>card</p>`,
        }),
    )
    const page = files['index.abide']
    expect(page?.server).toContain(`import('#src/lib/Card.abide?component')`)
    expect(page?.client).toContain(`import('#src/lib/Card.abide?component')`)
    expect(page?.client).toContain(`import('./lib/data.ts')`)
    expect(files['lib/Card.abide']?.client).toContain('card')
})

// An app holding `files` beside a home page, compiled — or the refusal that stopped it.
async function compiledTree(
    files: Record<string, string>,
): Promise<{ routes: string[]; refused: string }> {
    let routes: string[] = []
    const refused = await refusal(
        compileApp(
            appFixture({
                'index.abide': '<p>home</p>',
                ...files,
            }),
        ).then((compiled) => {
            routes = compiled.routes.map((route) => route.pattern)
        }),
    )
    return { routes, refused }
}

// 23.21 — A `.abide` DIRECTLY IN AN ADDRESS DIRECTORY IS A PAGE, whatever its name says it is: a
// `Card.abide` beside a page answers at `/media/Card`, and the same file under `lib/` answers at
// nothing. Where it sits decides, so no name an author picks can be read as a component's.
//
// THE REVERT: have `placement` answer `page` for an `index.abide` alone, as it once did for a
// `page.abide`; `media/Card.abide` is then no route — 1 route where 2 are due. Or compare
// `LAUNCHER_PAGE` with the name rather than the path; `media/launcher.abide` reads as a component.
test('a .abide directly in an address directory is a page, and one under lib is not — 23.21', async () => {
    expect(placement('media/Card.abide').kind).toBe('page')
    expect(placement('media/lib/Card.abide').kind).toBe('component')
    expect(placement('launcher.abide').kind).toBe('component')
    expect(placement('media/launcher.abide').kind).toBe('page')
    const beside = await compiledTree({ 'media/Card.abide': '<p>card</p>' })
    expect(beside.routes).toEqual(['/', '/media/Card'])
    const fenced = await compiledTree({ 'media/lib/Card.abide': '<p>card</p>' })
    expect(fenced.routes).toEqual(['/'])
})

// 23.22, 16.73 — AN ADDRESS DIRECTORY HOLDS ADDRESSES AND NOTHING ELSE: a `<name>.handler.ts`
// there is a handler file, held to exporting a handler as its default alone, and any other file —
// a bare `.ts` among them — is refused by name with where it goes. A test file, a bench file and a
// declaration file are kept there, and the rest under `lib/`.
//
// THE REVERTS: drop the `refuse` for a file neither `.abide` nor a handler file in `appTree`'s
// walk; the three strays build, 0 of 3 refused where 3 are due. Or drop `isDeclarationFile` from the
// walk's skip; `media/types.d.ts` is refused under 23.22. Or drop `isBenchFile` from it;
// `media/index.bench.ts` is refused under 23.22 too. Or skip the non-default export check in
// `handlersUnder`; `helpers.handler.ts` builds, a module answering at `/media/helpers` with no handler.
test('a file in an address directory that is no page or handler file is a build error — 23.22, 16.73', async () => {
    const helpers = await compiledTree({
        'media/helpers.handler.ts':
            'export const twice = (n: number): number => n * 2\n',
    })
    expect(helpers.refused).toContain('media/helpers.handler.ts')
    expect(helpers.refused).toContain('`twice`')
    expect(helpers.refused).toContain('RULEBOOK 16.73')
    const bare = await compiledTree({
        'media/helpers.ts':
            'export const twice = (n: number): number => n * 2\n',
    })
    expect(bare.refused).toContain('media/helpers.ts')
    expect(bare.refused).toContain('<name>.handler.ts')
    expect(bare.refused).toContain('lib directory')
    expect(bare.refused).toContain('RULEBOOK 23.22')
    const STRAYS: Record<string, string> = {
        'notes.md': '# notes\n',
        'styles.css': 'p { color: red }\n',
    }
    for (const [name, text] of Object.entries(STRAYS)) {
        const { refused } = await compiledTree({ [`media/${name}`]: text })
        expect(refused).toContain(`media/${name}`)
        expect(refused).toContain('lib directory')
        expect(refused).toContain('RULEBOOK 23.22')
    }
    const kept: Record<string, string> = {
        'media/lib/helpers.ts':
            'export const twice = (n: number): number => n * 2\n',
        // 23.22 — a test file beside the page it tests, as under `lib/`.
        'media/index.test.ts': 'export {}\n',
        // 23.22 — a bench file beside the code it times, as a test file is.
        'media/index.bench.ts': 'export function priced() {}\n',
        // 23.22 — a declaration file beside the page it types.
        'media/types.d.ts': 'export type Id = string\n',
        'media/lib/types.d.ts': 'export type Id = string\n',
        'media/lib/helpers.test.ts': 'export {}\n',
    }
    for (const [name, text] of Object.entries(STRAYS))
        kept[`media/lib/${name}`] = text
    expect(await compiledTree(kept)).toEqual({ routes: ['/'], refused: '' })
})

// 23.16, 23.18 — A FENCE HOLDS NO FENCE AND NO ADDRESS: `lib/public/` would be a second answer to
// what `lib/` already fenced, and an `index.abide` under `lib/` names a route that nothing there
// has. Both are refused naming the file, rather than one silently going unrouted.
//
// THE REVERTS: drop the 23.16 `refuse` for a reserved directory under another in `appTree`'s walk;
// `lib/public/` builds. Or drop the `DIRECTORY_FILES` arm; `lib/index.abide` builds as a component.
test('a fence under a fence, and an index.abide under lib, are build errors — 23.16, 23.18', async () => {
    const nested = await compiledTree({ 'media/lib/public/a.txt': 'a' })
    expect(nested.refused).toContain('media/lib/public')
    expect(nested.refused).toContain('RULEBOOK 23.16')
    const indexed = await compiledTree({ 'media/lib/index.abide': '<p>x</p>' })
    expect(indexed.refused).toContain('media/lib/index.abide')
    expect(indexed.refused).toContain('RULEBOOK 23.18')
})

// 16.29, 23.23 — A SERVER FILE IS ITS NAME, NOT ITS DIRECTORY: `lib/db.server.ts` builds and is the
// server's, a `server` directory is a segment like any other, and a dot directory is never walked.
//
// THE REVERTS: refuse a server file under `lib` too in `appTree`'s walk; `lib/db.server.ts` is
// refused. Or match `server` as a directory in `isServerFile`; `server/db.ts` reads as one.
test('a server file under lib builds, and is the server file by its name — 16.29, 23.23', async () => {
    const nested = await compiledTree({
        'media/lib/db.server.ts': 'export const db = 1\n',
        'media/lib/deep/key.server.pem': 'KEY',
    })
    expect(nested.refused).toBe('')
    expect(isServerFile('media/lib/db.server.ts')).toBe(true)
    expect(isServerFile('media/lib/deep/key.server.pem')).toBe(true)
    expect(isServerFile('media/lib/server/db.ts')).toBe(false)
    expect(isServerFile('media/lib/.server.ts')).toBe(false)
    expect(placeOf('media/lib/db.server.ts')).toBe('lib')
    expect(placeOf('lib/.cache/x.ts')).toBe('lib')
})

// 37.13 — A HOOK IS CALLED IN AN ADDRESSED FILE: one in a plain module runs as the module is
// imported, before any route is set, and never where nothing imports it. Refused naming the module
// and the hook, a server file and any other under `lib/` alike, through a namespace too; a hook's name is no hook
// where abide did not hand it to the module.
//
// THE REVERTS: drop the `refuseModuleHooks` call in `compileApp`; both modules build, and their
// middleware is filed at the root by whichever import evaluates it first. Or refuse every hook name
// called in a module importing abide; `lib/emitter.ts` is refused.
test('a hook called in a module that is no .abide nor handler file is a build error — 37.13', async () => {
    const HOOKED = `import { middleware } from '@abide/abide/server'\n\nmiddleware((next) => next())\n`
    const served = await compiledTree({ 'lib/guard.server.ts': HOOKED })
    expect(served.refused).toContain('lib/guard.server.ts calls middleware')
    expect(served.refused).toContain('RULEBOOK 37.13')
    const library = await compiledTree({ 'media/lib/guard.ts': HOOKED })
    expect(library.refused).toContain('media/lib/guard.ts calls middleware')
    const namespaced = await compiledTree({
        'lib/boot.ts': `import * as server from '@abide/abide/server'\n\nserver.onStart((start) => start())\n`,
    })
    expect(namespaced.refused).toContain('lib/boot.ts calls onStart')
    const unrelated = await compiledTree({
        'lib/emitter.ts': `import { reactive } from '@abide/abide'\n\nexport const count = reactive(0)\nexport const run = (source: { onStart(f: () => void): void }) => source.onStart(() => {})\n`,
    })
    expect(unrelated.refused).toBe('')
})

// 38.107 — `onLauncher` IS READ FROM THE ROOT'S `launcher.abide` ALONE, so a call anywhere else is
// options no window ever opens with. Refused naming the file that made it.
//
// THE REVERT: drop the `refuseStrayLauncher` call in `compileApp`; the page's call builds, and
// its options are filed where the launcher never reads them. Or skip a name after a `.` in
// `hookCalls`; the handler file's `server.onLauncher(…)` builds.
test('onLauncher called in a page is a build error, and in the root launcher.abide is not — 38.107', async () => {
    const LAUNCHES = `<script server>
import { onLauncher } from '@abide/abide/server'

onLauncher(() => ({}))
</script>

<p>launch</p>`
    const stray = await compiledTree({ 'media/index.abide': LAUNCHES })
    expect(stray.refused).toContain('media/index.abide')
    expect(stray.refused).toContain('RULEBOOK 38.107')
    const member = await compiledTree({
        'media/getLaunch.handler.ts': `import * as server from '@abide/abide/server'

server.onLauncher(() => ({}))

export default server.GET(() => 'ok')
`,
    })
    expect(member.refused).toContain('media/getLaunch.handler.ts')
    expect(member.refused).toContain('RULEBOOK 38.107')
    expect(await compiledTree({ 'launcher.abide': LAUNCHES })).toEqual({
        routes: ['/'],
        refused: '',
    })
})
