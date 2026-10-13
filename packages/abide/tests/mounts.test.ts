// 23.19, 23.20 — A PACKAGE'S DIRECTORY, MOUNTED WHERE THE APP SAYS. `import 'admin-kit/admin' with
// { type: 'routes' }` in the app's `tools/layout.abide` puts the package's pages, layouts and handlers
// below `/tools`: the app decides the address, and moving the line moves the package.
//
// THE REVERT: in `appGraph`, read `relative` where it reads `position`; the package's pages are
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
    'node_modules/admin-kit/admin/page.abide': '<p>admin home</p>',
    'node_modules/admin-kit/admin/users/layout.abide':
        '<div class="users"><slot/></div>',
    'node_modules/admin-kit/admin/users/[id]/page.abide':
        '<p>one admin user</p>',
    'node_modules/admin-kit/admin/users/page.abide': `<script server>
import { GET } from '@abide/abide/server'

export const list = GET(() => ['ada', 'grace'])
</script>
`,
}

const APP = {
    'layout.abide': '<html><head></head><body><slot/></body></html>',
    'page.abide': '<p>home</p>',
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
                'elsewhere/page.abide': '<p>own</p>',
                'tools/layout.abide': `<script module>
import '../elsewhere' with { type: 'routes' }
</script>
`,
            }),
        ),
    )
    expect(own).toContain('23.20')
})
