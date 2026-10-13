// 34.23 — A `.abide` A PACKAGE SHIPS AS SOURCE IS ONE OF THE APP'S COMPONENTS: compiled with the app
// wherever it lies (34.23), never an address (34.24), typed by the app's project (34.25), on the app's
// abide (34.26). A handler a package's `.ts` declares has no address of its own (34.27) — it answers
// where an app's handler file re-exports it (16.2). And `abide dev` follows an edit to one (38.99).

import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, symlinkSync } from 'node:fs' // bun has no sync mkdir or symlink of its own
import { compileApp } from '#compiler/compileApp.ts'
import { serveCompilation } from '#server/abideModules.ts'
import { renderDocument } from '#server/render.ts'
import { addressOf, BIN } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

const SHELL = '<!doctype html><html><head></head><body></body></html>'

// The package: a component reading a prop and holding a value by name, a helper beside it, an
// `index.abide` of the package's own layout, and a handler file. Its own `@abide/abide` is a copy
// that throws on import — the one bun would load for it, were it not asked from the app's root.
const KIT = {
    'node_modules/kit/package.json': JSON.stringify({
        name: 'kit',
        type: 'module',
        exports: { './*': './*' },
    }),
    'node_modules/kit/shout.ts':
        'export const shout = (text: string): string => text.toUpperCase()\n',
    'node_modules/kit/Badge.abide': `<script>
import { props, reactive } from '@abide/abide'
import { shout } from './shout.ts'

const { label } = props<{ label: string }>()
let count = reactive(0)
</script>

<button class="badge" onclick={() => { count = count + 1 }}>{shout(label)} {count}</button>
`,
    'node_modules/kit/index.abide': '<p>the package’s own page</p>',
    'node_modules/kit/charge.ts': `import { POST } from '@abide/abide/server'

export default POST(({ cents }: { cents: number }) => ({ charged: cents }))
`,
    // TYPED AS THE APP'S, as a second install of the same abide is: what differs is the instance.
    'node_modules/kit/node_modules/@abide/abide/package.json': JSON.stringify({
        name: '@abide/abide',
        type: 'module',
        exports: {
            '.': { types: './shared.d.ts', default: './copy.js' },
            './server': { types: './server.d.ts', default: './copy.js' },
        },
    }),
    'node_modules/kit/node_modules/@abide/abide/shared.d.ts': `export * from '${new URL('../src/shared/index.ts', import.meta.url).pathname}'\n`,
    'node_modules/kit/node_modules/@abide/abide/server.d.ts': `export * from '${new URL('../src/server/index.ts', import.meta.url).pathname}'\n`,
    'node_modules/kit/node_modules/@abide/abide/copy.js':
        "throw new Error('the package’s own copy of abide was loaded')\n",
}

const APP = {
    'package.json': JSON.stringify({
        name: 'kit-app',
        type: 'module',
        imports: { '#src/*': './*' },
    }),
    'index.abide': `<script>
import Badge from 'kit/Badge.abide'
import Own from 'kit/index.abide'
</script>

<main><Badge label="hello" /><Own /></main>`,
    'billing/charge.ts': `export { default } from 'kit/charge.ts'\n`,
}

// THE REVERTS: drop `withDependencies` from `compileApp` and the page's import of `kit/Badge.abide`
// reaches no compile — the render throws (34.23); drop `placeOf`'s `node_modules` test and the
// package's `index.abide` is a second route, `/node_modules/kit` (34.24); drop
// `allowArbitraryExtensions` from the session config and the checker refuses the badge as outside
// the project (34.25); drop `onAbideOf` from `emitApp` and the render loads the package's copy of
// abide, which throws (34.26).
test("a package's component compiles with the app, on the app's abide, and is no address — 34.23, 34.24, 34.25, 34.26", async () => {
    const root = temporaryModule({ ...APP, ...KIT })
    const compiled = await compileApp(root)
    expect(compiled.routes.map((route) => route.pattern)).toEqual(['/'])
    const badge = compiled.files['node_modules/kit/Badge.abide']
    // 31.3 — `count = count + 1` read by name, which only the checker could have answered.
    expect(badge?.client).toContain('count.set(count() + 1)')
    serveCompilation(root, compiled)
    const { default: Page } = await import(`${root}/index.abide?component`)
    const html = new TextDecoder().decode(await renderDocument(Page, SHELL))
    expect(html).toContain('HELLO 0')
    expect(html).toContain('the package’s own page')
})

// THE REVERT: drop `node_modules` from `skipped` in `routePattern`; the walk reads the package's
// `charge.ts` as one of the app's handler files and mounts it a second time, at
// `/node_modules/kit/charge`.
test("a package's handler is mounted where the app re-exports it, and nowhere else — 34.27, 16.2", async () => {
    const compiled = await compileApp(temporaryModule({ ...APP, ...KIT }))
    expect(compiled.mounts.map((mount) => mount.address)).toEqual([
        '/billing/charge',
    ])
})

// A LINKED PACKAGE LIES OUTSIDE THE ROOT, which is where bun resolves it to. THE REVERTS: drop the
// real-path lookup from `TypeSession.shadowAt`, or the session config's `files`; the checker reads the
// re-export through the link as an empty module, and refuses `billing/charge.ts` as exporting no
// handler (16.73).
test('a linked package outside the root compiles with the app — 34.23, 34.25', async () => {
    const outside = temporaryModule(
        Object.fromEntries(
            Object.entries(KIT)
                .filter(([name]) => !name.includes('/node_modules/@abide'))
                .map(([name, text]) => [
                    name.slice('node_modules/kit/'.length),
                    text,
                ]),
        ),
    )
    const root = temporaryModule(APP)
    mkdirSync(`${root}/node_modules`)
    symlinkSync(outside, `${root}/node_modules/kit`)
    const compiled = await compileApp(root)
    expect(compiled.mounts.map((mount) => mount.address)).toEqual([
        '/billing/charge',
    ])
    serveCompilation(root, compiled)
    const { default: Page } = await import(`${root}/index.abide?component`)
    expect(
        new TextDecoder().decode(await renderDocument(Page, SHELL)),
    ).toContain('HELLO 0')
})

// 38.99 — AN EDIT TO A LINKED PACKAGE'S `.abide` REBUILDS THE APP. THE REVERT: drop
// `watchDependencies` from `serveDev`'s compile; the page still says `HELLO` after the edit.
test("abide dev rebuilds when a linked package's .abide changes — 38.99", async () => {
    const outside = temporaryModule({
        'package.json': JSON.stringify({
            name: 'kit',
            type: 'module',
            exports: { './*': './*' },
        }),
        'Badge.abide': '<b>HELLO</b>',
    })
    const root = temporaryModule({
        'package.json': APP['package.json'],
        'index.abide': `<script>\nimport Badge from 'kit/Badge.abide'\n</script>\n\n<main><Badge /></main>`,
    })
    mkdirSync(`${root}/node_modules`)
    symlinkSync(outside, `${root}/node_modules/kit`)
    const dev = Bun.spawn(['bun', BIN, 'dev', '--root', root, '--port', '0'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
    })
    try {
        const base = await addressOf(dev)
        expect(await (await Bun.fetch(`${base}/`)).text()).toContain(
            '<b>HELLO</b>',
        )
        await Bun.write(`${outside}/Badge.abide`, '<b>EDITED</b>')
        let html = ''
        for (
            let tries = 0;
            tries < 60 && !html.includes('EDITED');
            tries += 1
        ) {
            await Bun.sleep(100)
            html = await (await Bun.fetch(`${base}/`)).text().catch(() => '')
        }
        expect(html).toContain('<b>EDITED</b>')
    } finally {
        dev.kill()
    }
}, 30_000)
