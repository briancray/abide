// 23.19, 23.20 — A PACKAGE'S DIRECTORY, MOUNTED WHERE THE APP SAYS. `import 'admin-kit/admin' with
// { type: 'routes' }` in the app's `tools/layout.abide` puts the package's pages, layouts and handler
// files below `/tools`: the app decides the address, and moving the line moves the package.
//
// THE REVERT: in `appLayout`, place a source at `relative` where it reads `position`; the package's pages are
// components again, `/tools` and `/tools/users/[id]` leave the route table, and the served page is a
// 404.

import { afterAll, expect, test } from 'bun:test'
import { compileApp } from '#compiler/compileApp.ts'
import { appFixture, buildApp, startApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'
import { refusal } from './typed.ts'

afterAll(removeTemporaryModules)

const KIT = {
    'node_modules/admin-kit/package.json': JSON.stringify({
        name: 'admin-kit',
        type: 'module',
    }),
    'node_modules/admin-kit/admin/index.abide': '<p>admin home</p>',
    'node_modules/admin-kit/admin/users/layout.abide':
        '<div class="users"><slot/></div>',
    'node_modules/admin-kit/admin/users/[id]/index.abide':
        '<p>one admin user</p>',
    'node_modules/admin-kit/admin/users/list.ts': `import { GET } from '@abide/abide/server'

export default GET(() => ['ada', 'grace'])
`,
}

const APP = {
    'layout.abide': '<html><head></head><body><slot/></body></html>',
    'index.abide': '<p>home</p>',
    'tools/layout.abide': `<script module>
import 'admin-kit/admin' with { type: 'routes' }
</script>

<section class="tools"><slot/></section>
`,
}

test("a mounted package's pages, layouts and handlers answer below the mounting file — 23.19", async () => {
    const compiled = await compileApp(appFixture({ ...APP, ...KIT }))
    expect(compiled.routes.map((route) => route.pattern).sort()).toEqual([
        '/',
        '/tools',
        '/tools/users/[id]',
    ])
    const user = compiled.routes.find(
        (route) => route.pattern === '/tools/users/[id]',
    )
    // The app's layouts above the mount, then the package's own below it, outermost first.
    expect(user?.layouts).toEqual([
        'layout.abide',
        'tools/layout.abide',
        'node_modules/admin-kit/admin/users/layout.abide',
    ])
    expect(compiled.mounts.map((mount) => mount.address)).toEqual([
        '/tools/users/list',
    ])
})

test('a mounted page is served at the address the app gave it — 23.19', async () => {
    const app = appFixture({ ...APP, ...KIT })
    const built = await buildApp(app)
    expect(built.stderr).not.toContain('RULEBOOK')
    const { base, stop } = await startApp(app)
    try {
        const answer = await Bun.fetch(`${base}/tools/users/7`)
        expect(answer.status).toBe(200)
        const html = await answer.text()
        expect(html).toContain('class="tools"')
        expect(html).toContain('class="users"')
        expect(html).toContain('one admin user')
        const listed = await Bun.fetch(`${base}/tools/users/list`)
        expect(await listed.json()).toEqual(['ada', 'grace'])
    } finally {
        stop()
    }
})

// 37.2 — A HANDLER ANSWERS BY ITS MOUNT, so the guard the app files over the mount guards it. THE
// REVERT: in `mountHandlers`, take the hook route from the row's `source` (the package's path on
// disk) rather than its address; the list answers 200 past the guard.
test("the app's middleware over a mount guards the package's handlers — 23.19, 37.2", async () => {
    const app = appFixture({
        ...APP,
        ...KIT,
        'tools/layout.abide': `<script module>
import 'admin-kit/admin' with { type: 'routes' }
</script>

<script server>
import { middleware } from '@abide/abide/server'

middleware(() => new Response('forbidden', { status: 403 }))
</script>

<section class="tools"><slot/></section>
`,
    })
    const built = await buildApp(app)
    if (built.exitCode !== 0) throw new Error(built.stderr)
    const { base, stop } = await startApp(app)
    try {
        expect((await Bun.fetch(`${base}/tools/users/7`)).status).toBe(403)
        expect((await Bun.fetch(`${base}/tools/users/list`)).status).toBe(403)
    } finally {
        stop()
    }
})

test('a directory mounts once — 23.20', async () => {
    const thrown = await refusal(
        compileApp(
            appFixture({
                ...APP,
                ...KIT,
                'more/layout.abide': `<script module>
import 'admin-kit/admin' with { type: 'routes' }
</script>
`,
            }),
        ),
    )
    expect(thrown).toContain('23.20')
})

test('a mount names a directory that is there, and not the app’s own — 23.19, 23.20', async () => {
    const missing = await refusal(
        compileApp(
            appFixture({
                ...APP,
                ...KIT,
                'tools/layout.abide': `<script module>
import 'admin-kit/nowhere' with { type: 'routes' }
</script>
`,
            }),
        ),
    )
    expect(missing).toContain('23.19')
    const own = await refusal(
        compileApp(
            appFixture({
                ...APP,
                'elsewhere/index.abide': '<p>own</p>',
                'tools/layout.abide': `<script module>
import '../elsewhere' with { type: 'routes' }
</script>
`,
            }),
        ),
    )
    expect(own).toContain('23.20')
})

// 16.29, 23.19 — A MOUNTED PACKAGE'S `server` DIRECTORY IS FENCED FROM THE BROWSER, as the app's own
// is: its files take the position the mount gives them, and the fence reads a file's place there,
// wherever the package lies. THE REVERT: read `placeOf` off the path below the root in
// `fenceServer`; the module lies under `node_modules`, reads as a dependency's, and its secret is
// bundled — the build exits 0.
test("a mounted package's server directory is fenced from the browser — 16.29, 23.19", async () => {
    const app = appFixture({
        ...APP,
        ...KIT,
        'node_modules/admin-kit/admin/server/secret.ts':
            "export const SECRET = 'mounted-secret'\n",
        'node_modules/admin-kit/admin/index.abide': `<script>
import { SECRET } from './server/secret.ts'
</script>

<p>{SECRET}</p>`,
    })
    const built = await buildApp(app)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('tools/server/secret.ts')
    expect(built.stderr).toContain('RULEBOOK 16.29')
}, 30_000)

// 16.74, 23.19 — A MOUNTED PAGE IMPORTING ITS OWN HANDLER FILE IS HANDED THE WRAPPER, as an app's own
// page is: the handler file is the app's at its mount, wherever the package lies, so the browser's
// bundle holds the call over the wire and never the file. THE REVERT: pass over an importer under
// `node_modules` in `abideModules`' handler hook, as it once did; the browser's bundle takes the
// handler file raw, abide's server barrel with it, and the build exits 1 where 0 is due.
test("a mounted page's import of its own handler file is the browser's wrapper — 16.74, 23.19", async () => {
    const app = appFixture({
        ...APP,
        ...KIT,
        'node_modules/admin-kit/admin/users/list.ts': `import { GET } from '@abide/abide/server'

export default GET(() => ['handler-body-marker'])
`,
        'node_modules/admin-kit/admin/index.abide': `<script>
import list from './users/list.ts'

const names = list()
</script>

<p>{names}</p>`,
    })
    const built = await buildApp(app)
    expect(built.stderr).not.toContain('RULEBOOK')
    expect(built.exitCode, built.stderr).toBe(0)
    let bundle = ''
    for (const chunk of new Bun.Glob('**/*.js').scanSync({
        cwd: `${app}/.abide/client`,
    }))
        bundle += await Bun.file(`${app}/.abide/client/${chunk}`).text()
    expect(bundle).toContain('tools/users/list')
    expect(bundle.split('handler-body-marker').length - 1).toBe(0)
}, 30_000)
