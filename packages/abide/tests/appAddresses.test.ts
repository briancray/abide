// 23.14 — AN APP'S ADDRESSES ARE ITS FILES' PATHS: a page is a `.abide` directly in an address
// directory (23.21), an `index.abide` answering at its directory's path; a handler file is a
// `.server.ts` there, answering at its own path (16.2); a `<script server>` declares private handlers below
// `/__abide/handlers/` (16.70); and pages and handlers answer in one table of routes (19.1, 19.20).
// A fence is never an address (23.15, 23.16), and a server file is the server's alone (16.29). A
// route's hooks run over it and what lies below it, a fenced file's at the route holding its fence
// (37.1, 37.2, 16.72).

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { checkApp } from '#compiler/checkApp.ts'
import { compileApp } from '#compiler/compileApp.ts'
import { rpc } from '#server'
import { buildFiles } from '#server/appBuild.ts'
import { MOUNT } from '#shared/mount.ts'
import { rpcRequest } from '#shared/rpcRequest.ts'
import { surfaceName } from '#shared/surfaceName.ts'

import { appFixture, buildApp, startApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'
import { refusal } from './typed.ts'

afterAll(removeTemporaryModules)

// A file holding nothing but a server block declaring `body`.
const SERVED = (body: string): string => `<script server>\n${body}\n</script>\n`

// 35.1 — A LAYOUT WRAPS EVERY PAGE BELOW ITS ROUTE, and 35.13 — one with no template wraps nothing. THE REVERT: give `layoutsAround` back a prefix over
// the FILE's directory; `/media` is wrapped in no layout, against 1.
test('a layout wraps the pages below its route — 35.1, 35.13, 23.14', async () => {
    const { routes } = await compileApp(
        appFixture({
            'layout.abide': '<slot/>',
            'index.abide': '<p>home</p>',
            'media/index.abide': '<p>media</p>',
            'media/[id]/index.abide': '<p>one</p>',
            'media/[id]/layout.abide': SERVED(''),
            'media/layout.abide': '<slot/>',
        }),
    )
    const chains: Record<string, string[]> = {}
    for (const route of routes) chains[route.pattern] = route.layouts
    expect(chains).toEqual({
        '/': ['layout.abide'],
        '/media': ['layout.abide', 'media/layout.abide'],
        '/media/[id]': ['layout.abide', 'media/layout.abide'],
    })
})

// 35.14 — AN `error.abide` WITH NOTHING TO PAINT IS ITS ROUTE'S SERVER BLOCK ALONE, as a page
// with nothing to paint is (23.3). THE REVERT: limit `paints` in `compileApp` to pages; the
// server's error table lists the hooks-only file, which would shadow every error page above it.
test('an error.abide with neither template nor head answers for no page — 35.14', async () => {
    const { tables } = await compileApp(
        appFixture({
            'index.abide': '<p>home</p>',
            'error.abide': '<p>root error</p>',
            'media/error.abide': SERVED(''),
            'media/index.abide': '<p>media</p>',
        }),
    )
    const table = tables['server.ts'] as string
    const errors = table.slice(
        table.indexOf('export const errors'),
        table.indexOf('export const servers'),
    )
    expect(errors).toContain('"../error.abide?component"')
    expect(errors).not.toContain('media/error.abide')
})

// 23.15 — `ui` IS A DIRECTORY LIKE ANY OTHER: a page in one has an address, a `.server.ts` in one is a
// handler file, and a server block may import a module from a `lib` under one. THE REVERT: add `ui`
// back to `RESERVED_DIRECTORIES`; `/ui` has no page, and the build refuses the page under it (23.18).
test('a ui directory is an ordinary one — 23.15', async () => {
    const { routes, mounts } = await compileApp(
        appFixture({
            'index.abide': '<p>home</p>',
            'ui/index.abide': '<p>ui</p>',
            'media/ui/lib/format.ts':
                'export const format = (n: number) => `${n}`\n',
            'media/ui/status.server.ts':
                "import { rpc } from '@abide/abide/server'\n\nexport default rpc(() => 'up')\n",
            'media/index.abide': SERVED(
                "import { format } from './ui/lib/format.ts'\n\nexport const count = () => format(1)",
            ),
        }),
    )
    expect(routes.map((route) => route.pattern).sort()).toEqual(['/', '/ui'])
    expect(mounts.map((mount) => mount.address)).toContain('/media/ui/status')
})

// 23.14 — A ROUTE IS THE APP'S OWN: a page a dependency ships is not one, nor one
// under a dot directory. THE REVERT: list `appFiles`'s files with `Bun.Glob('**/*.abide')`, as it
// once did; the scaffold a package carries answers at `/node_modules/kit/scaffold`.
test("a page inside node_modules is not the app's — 23.14", async () => {
    const { routes } = await compileApp(
        appFixture({
            'index.abide': '<p>home</p>',
            'node_modules/kit/scaffold/index.abide': '<p>kit</p>',
            '.cache/index.abide': '<p>cached</p>',
        }),
    )
    expect(routes.map((route) => route.pattern)).toEqual(['/'])
})

// 35.12 — one layout to a route, parameter names aside: `[id]` and `[slug]` are one route. THE
// REVERT: drop the `held` check in `compileApp`; the build succeeds with the route wrapped twice.
test('two layouts at one route are refused, naming both — 35.12', async () => {
    const refused = await refusal(
        compileApp(
            appFixture({
                'media/[id]/layout.abide': '<slot/>',
                'media/[slug]/layout.abide': '<slot/>',
                'media/[id]/index.abide': '<p>media</p>',
            }),
        ),
    )
    expect(refused).toContain('35.12')
    expect(refused).toContain('media/[id]/layout.abide')
    expect(refused).toContain('media/[slug]/layout.abide')
})

// 16.2, 16.70, 23.14 — A HANDLER FILE ANSWERS AT ITS OWN PATH, and a private handler below
// `/__abide/handlers/` at its file's path, brackets dropped, and its binding's name — taking no
// parameter from the path, and filed at its file's route, or for one under a `lib`, at the route
// holding it (37.1); 23.3 — a page with nothing to paint is no page. THE REVERTS: route a handler
// file by its directory in `routeOf`; `save` answers at `/media/[id]`. Address a private handler
// by its binding alone in `handlersUnder`; `rate` answers at `/__abide/handlers/rate`.
test('a handler file answers at its path, and a private handler below /__abide/handlers — 16.2, 16.70, 23.3, 23.14', async () => {
    const { mounts, routes } = await compileApp(
        appFixture({
            'media/[id]/index.abide': `${SERVED('export const rate = () => 1')}<p>one</p>`,
            'media/[id]/save.server.ts':
                "import { rpc } from '@abide/abide/server'\n\nexport default rpc(({ id }: { id: string }) => id, { methods: ['POST'] })\n",
            'media/[id]/comments/addComment.server.ts':
                "import { rpc } from '@abide/abide/server'\n\nexport default rpc(({ id }: { id: string }) => id, { methods: ['POST'] })\n",
            'admin/lib/Panel.abide': `${SERVED('export const recent = () => 1')}<p>panel</p>`,
            'admin/index.abide': SERVED(''),
            'health.server.ts':
                "import { rpc } from '@abide/abide/server'\n\nexport default rpc(() => 1)\n",
        }),
    )
    const addresses: string[] = []
    for (const mount of mounts)
        addresses.push(
            `${mount.method} ${mount.address} ${mount.private ? 'private' : 'public'} ${mount.scope}`,
        )
    expect(addresses.sort()).toEqual([
        'GET /__abide/handlers/admin/lib/Panel/recent private /admin',
        'GET /__abide/handlers/media/id/index/rate private /media/[id]',
        'GET /health public /health',
        'POST /media/[id]/comments/addComment public /media/[id]/comments/addComment',
        'POST /media/[id]/save public /media/[id]/save',
    ])
    expect(routes.map((route) => route.pattern)).toEqual(['/media/[id]'])
})

// 19.1 — ONE FILE PER METHOD PER ROUTE, two routes differing only in their parameters' names being one
// route. THE REVERT: drop `refuseSharedRoutes` from `compileApp`; the build succeeds.
test('a page and a GET handler at one address are refused, parameter names aside — 19.1', async () => {
    const page = await refusal(
        compileApp(
            appFixture({
                'media/[id]/save/index.abide': '<p>saving</p>',
                'media/[slug]/save.server.ts':
                    "import { rpc } from '@abide/abide/server'\n\nexport default rpc(({ slug }: { slug: string }) => slug)\n",
            }),
        ),
    )
    expect(page).toContain('19.1')
    expect(page).toContain('media/[id]/save/index.abide')
    expect(page).toContain('media/[slug]/save.server.ts')
})

// 16.67 — a parameter the handler's `Args` does not declare. THE REVERT: drop
// `refuseUndeclaredParameters` from `handlersUnder`; the build succeeds and `id` reaches a handler
// that never typed it.
test('a handler whose args do not declare its route parameter is refused — 16.67', async () => {
    const refused = await refusal(
        compileApp(
            appFixture({
                'index.abide': '<p>home</p>',
                'media/[id]/read.server.ts':
                    "import { rpc } from '@abide/abide/server'\n\nexport default rpc(() => 1)\n",
            }),
        ),
    )
    expect(refused).toContain('16.67')
    expect(refused).toContain('`id`')
})

// 34.17 — `export *` IS REFUSED FROM A `.abide`'s SERVER BLOCK: a server block exports one declared
// name at a time, each its component's to call (16.70), and a re-export declares none. THE REVERT:
// skip `export` in `projectShadow`'s `refuseExport`; the `.abide` builds.
test('export * is refused from a server block — 34.17', async () => {
    const charges = `import { rpc } from '@abide/abide/server'\n\nexport const charge = rpc(() => 1, { methods: ['POST'] })\nexport const helper = 2\n`
    const block = await refusal(
        compileApp(
            appFixture({
                'billing/lib/charges.server.ts': charges,
                'billing/index.abide': `<script server>\nexport * from './lib/charges.server.ts'\n</script>\n\n<p>billing</p>`,
            }),
        ),
    )
    expect(block).toContain('34.17')
})

// 34.20, 34.17 — a server block under a `public` directory has no route to be filed at, and a
// server block exports nothing, `default` included.
// THE REVERTS: drop the 34.20 refusal in `appLayout`'s `refusePlace`; skip `export` in `projectShadow`'s `refuseExport`.
test('a server block under a public directory, and one exporting default, are refused — 34.20, 34.17', async () => {
    const outside = await refusal(
        compileApp(
            appFixture({
                'index.abide': '<p>home</p>',
                'media/public/Rating.abide': SERVED(
                    'export const rate = () => 1',
                ),
            }),
        ),
    )
    expect(outside).toContain('34.20')
    expect(outside).toContain('media/public/Rating.abide')
    const named = await refusal(
        compileApp(
            appFixture({
                'index.abide': SERVED('export default 1'),
            }),
        ),
    )
    expect(named).toContain('34.17')
})

// 23.16, 23.17, 23.18, 23.22, 23.23 — what the tree may not hold: a fence under another, a route in
// abide's own namespace, a page where nothing has an address, a file directly in an address
// directory that is neither a `.abide`, a handler file (`<name>.server.ts`) nor a test file, and a
// server file outside a `lib` directory. THE REVERTS: drop each `refusals.at` in `appFiles`'s `walk` (or
// `appLayout`'s `refuseFrameworkRoute`); its build succeeds.
test('a fence under another, a page under one, an __abide route, a stray file and a stray server file are refused — 23.16, 23.17, 23.18, 23.22, 23.23', async () => {
    const nested = await refusal(
        compileApp(
            appFixture({
                'index.abide': '<p>home</p>',
                'media/lib/public/format.ts': 'export const format = 1\n',
            }),
        ),
    )
    expect(nested).toContain('23.16')
    expect(nested).toContain('media/lib/public')
    const hidden = await refusal(
        compileApp(
            appFixture({
                'index.abide': '<p>home</p>',
                'media/lib/index.abide': '<p>hidden</p>',
            }),
        ),
    )
    expect(hidden).toContain('23.18')
    expect(hidden).toContain('media/lib/index.abide')
    const framework = await refusal(
        compileApp(appFixture({ '__abide/index.abide': '<p>mine</p>' })),
    )
    expect(framework).toContain('23.17')
    const stray = await refusal(
        compileApp(
            appFixture({
                'index.abide': '<p>home</p>',
                'media/notes.json': '{}',
            }),
        ),
    )
    expect(stray).toContain('23.22')
    expect(stray).toContain('media/notes.json')
    expect(stray).toContain('lib')
    // a `.ts` not named `.server.ts` is no handler file, and the refusal says how to name one.
    const module = await refusal(
        compileApp(
            appFixture({
                'index.abide': '<p>home</p>',
                'media/format.ts': 'export const format = 1\n',
            }),
        ),
    )
    expect(module).toContain('23.22')
    expect(module).toContain('media/format.ts')
    expect(module).toContain('<name>.server.ts')
    // 16.73 — beside a page, a server file exporting no `rpc` is a module, answering nothing. THE
    // REVERT: put back the refusal of a server file in an address directory that exports no `rpc`;
    // the build refuses it.
    await compileApp(
        appFixture({
            'index.abide': '<p>home</p>',
            'media/db.server.ts': 'export const db = 1\n',
        }),
    )
    // 23.23 — under `public`, where it would be answered as authored.
    for (const file of ['public/key.server.pem']) {
        const server = await refusal(
            compileApp(
                appFixture({
                    'index.abide': '<p>home</p>',
                    [file]: 'export const db = 1\n',
                }),
            ),
        )
        expect(server).toContain('23.23')
        expect(server).toContain(file)
        expect(server).toContain('lib directory')
    }
})

// 16.29 — A SERVER FILE, AT ANY DEPTH, is refused to the browser's bundle, and a module it imports
// is not (36.10): `format.ts` is in both graphs. THE REVERT: drop `fenceServer` from
// `clientBundle`'s plugins; the build succeeds and the secret is in the bundle.
test('a page importing a server file under a nested lib fails the build — 16.29, 36.10', async () => {
    const fixture = appFixture({
        'media/lib/format.ts':
            'export const format = (s: string) => `[${s}]`\n',
        'media/lib/secret.server.ts':
            "import { format } from './format.ts'\n\nexport const SECRET = format('hunter2')\n",
        'media/index.abide': `<script>\nimport { SECRET } from '#src/media/lib/secret.server.ts'\n</script>\n\n<p>{SECRET}</p>`,
        'index.abide': `<script>\nimport { format } from '#src/media/lib/format.ts'\n</script>\n\n<p>{format('home')}</p>`,
    })
    const built = await buildApp(fixture)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('16.29')
    expect(built.stderr).toContain('media/lib/secret.server.ts')
    expect(built.stderr).not.toContain('media/lib/format.ts')
})

// 16.29 — A SERVER FILE ANSWERING AT ITS ROUTE CROSSES AS ITS `rpc`s ALONE, and a page importing any
// other export of it is refused in abide's words. THE REVERT: drop `serverExportImported` from
// `clientBundle`; the build still fails, in the bundler's words, with no `16.29` in them.
test("a page importing a server file's export that is no rpc fails the build — 16.29", async () => {
    const fixture = appFixture({
        'media/catalog.server.ts': `import { rpc } from '@abide/abide/server'\n\nexport const SECRET = 'hunter2'\n\nexport default rpc(() => 'shelf')\n`,
        'index.abide': `<script>\nimport { SECRET } from '#src/media/catalog.server.ts'\n</script>\n\n<p>{SECRET}</p>`,
    })
    const built = await buildApp(fixture)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('RULEBOOK 16.29')
    expect(built.stderr).toContain('"SECRET"')
})

// 16.29 — EVERY EDGE INTO A SERVER FILE, not only a module's: a file's text (34.21) and a component
// are as much the server's as a `.ts`. THE REVERT: register `fenceServer` after `abideModules`;
// both build, the key and the component in the bundle.
test('a page importing a server file as text, or a server component, fails the build — 16.29', async () => {
    for (const [file, page] of [
        [
            'lib/key.server.pem',
            `<script>\nimport KEY from '#src/lib/key.server.pem' with { type: 'text' }\n</script>\n\n<p>{KEY}</p>`,
        ],
        [
            'lib/Panel.server.abide',
            `<script>\nimport Panel from '#src/lib/Panel.server.abide'\n</script>\n\n<Panel/>`,
        ],
    ] as const) {
        const fixture = appFixture({
            'lib/key.server.pem': 'BEGIN-PRIVATE-KEY\n',
            'lib/Panel.server.abide': '<p>BEGIN-PRIVATE-PANEL</p>',
            'index.abide': page,
        })
        const built = await buildApp(fixture)
        expect(built.stderr).toContain('RULEBOOK 16.29')
        expect(built.stderr).toContain(file)
        expect(built.exitCode).not.toBe(0)
    }
}, 60_000)

// 23.5 — A PAGE UNDER `[...rest]` BUNDLES: bun refuses a plugin's `file` path holding `[...`, so the
// browser's component module is answered in a namespace of its own. THE REVERT: answer it as a
// `file` path; the build fails with "must be absolute".
test('an app with a page under a rest directory builds — 23.5', async () => {
    const fixture = appFixture({
        'index.abide': '<p>home</p>',
        'docs/[...rest]/index.abide': `<script>\nimport { reactive } from '@abide/abide'\n\nlet count = reactive(0)\n</script>\n\n<button onclick={() => { count = count + 1 }}>rest-page {count}</button>`,
    })
    const built = await buildApp(fixture)
    expect(built.stderr).not.toContain('must be absolute')
    expect(built.exitCode).toBe(0)
    const manifest = (await Bun.file(
        buildFiles(`${fixture}/.abide`).manifest,
    ).json()) as {
        chunks: Record<string, string[]>
    }
    const own = manifest.chunks['docs/[...rest]/index.abide']?.[0]
    expect(own).toBeDefined()
    expect(
        await Bun.file(
            `${buildFiles(`${fixture}/.abide`).client}/${own}`,
        ).text(),
    ).toContain('rest-page')
}, 60_000)

// 16.29 — A DEPENDENCY'S SERVER FILE IS FENCED AS THE APP'S OWN IS, its name saying it wherever it
// lies, and a `server` directory is a directory like any other. THE REVERT: skip a path under
// `node_modules` in `fenceServer`'s load; `kit/clock.server.ts` builds into the bundle.
test("a dependency's server file is fenced, and its server directory is not — 16.29", async () => {
    const files = {
        'node_modules/kit/package.json': '{"name":"kit","type":"module"}',
        'node_modules/kit/server/clock.ts': 'export const TICK = 1\n',
        'node_modules/kit/clock.server.ts': 'export const TOCK = 2\n',
    }
    const directory = await buildApp(
        appFixture({
            ...files,
            'index.abide': `<script>\nimport { TICK } from 'kit/server/clock.ts'\n</script>\n\n<p>{TICK}</p>`,
        }),
    )
    expect(directory.stderr).not.toContain('RULEBOOK')
    expect(directory.exitCode).toBe(0)
    const named = await buildApp(
        appFixture({
            ...files,
            'index.abide': `<script>\nimport { TOCK } from 'kit/clock.server.ts'\n</script>\n\n<p>{TOCK}</p>`,
        }),
    )
    expect(named.stderr).toContain('RULEBOOK 16.29')
    expect(named.stderr).toContain('kit/clock.server.ts')
    expect(named.exitCode).not.toBe(0)
}, 60_000)

// 34.19, 16.70 — THE BROWSER'S MODULE CARRIES A WRAPPER PER PRIVATE HANDLER AND NONE OF THE BLOCK:
// the same binding, unexported, over the wire — not the secret its body holds, not the hooks it
// files, which for a component under `lib` are filed at the route holding the fence (37.1). THE
// REVERT: emit `lowering.servers()` into the client lane too; the secret and the `fileRoute` call
// reach the browser's module.
test("a component's browser module carries its private handlers' wrappers and none of its server block — 34.19, 16.70", async () => {
    const { files } = await compileApp(
        appFixture({
            'media/[id]/lib/Rating.abide': `<script server>
const KEY = 'sk-not-for-browsers'
export const rate = ({ stars }: { stars: number }) => KEY.length + stars
</script>

<script>
import { reactive } from '@abide/abide'

let stars = reactive(0)
</script>

<button onclick={() => rate({ stars })}>rate</button>`,
            'media/[id]/index.abide': `<script>\nimport Rating from './lib/Rating.abide'\n</script>\n\n<Rating/>`,
        }),
    )
    const client = files['media/[id]/lib/Rating.abide']?.client ?? ''
    expect(client).toContain('const rate = __wire("GET"')
    expect(client).toContain('../handlers/media/id/lib/Rating/rate')
    expect(client).not.toContain('export const rate')
    expect(client).not.toContain('sk-not-for-browsers')
    expect(client).not.toContain('fileRoute')
    const server = files['media/[id]/lib/Rating.abide']?.server ?? ''
    expect(server).toContain('sk-not-for-browsers')
    expect(server).toContain('__fileRoute("/media/[id]")')
})

// 16.119 — A SERVER BLOCK EXPORTS BARE VALUES: one importing abide's `rpc` does not compile, and an
// `rpc` handed to `rpc` — a server file's, re-exported from a block — is refused as it is declared.
// THE REVERTS: drop `refuseServerRpc` from `projectShadow`; the block compiles and this reads ``. Let
// `rpc` hand an `rpc` back as it is; nothing is thrown.
test('a server block importing rpc does not compile, and an rpc over an rpc is refused — 16.119', async () => {
    const refused = await refusal(
        compileApp(
            appFixture({
                'index.abide': `<script server>
import { rpc } from '@abide/abide/server'

export const count = rpc(() => 1, { methods: ['POST'] })
</script>

<p>count</p>`,
            }),
        ),
    )
    expect(refused).toContain('RULEBOOK 16.119')
    // @ts-expect-error — 16.119: an `rpc` is not a value `rpc` takes, in the types as at run time.
    expect(() => rpc(rpc(() => 1))).toThrow('RULEBOOK 16.119')
})

// 16.70, 16.111, 16.117 — A MEMO OR A VALUE ANSWERS ITS READ ALONE until `methods` names its writes:
// one a server block exports bare is read at its private address below `/__abide/handlers` and
// written by nothing, and a server file's `rpc` naming `PATCH` answers that too, its copy sending
// `patch` and no other write. THE REVERTS: answer `able` with no `methods` in `declaredMethods`; the
// bare memo answers `PUT`, `PATCH` and `POST` too, the plain value `PUT` and `PATCH`, and their
// wrappers carry every verb. Skip `servedExports` in `projectShadow`'s `script`; the block's export
// is the memo itself and answers at no address.
test('a memo or a value answers its read alone until methods names its writes — 16.70, 16.111, 16.117', async () => {
    const { mounts, files, handlers } = await compileApp(
        appFixture({
            'index.abide': `<script>\nimport Counter from './lib/Counter.abide'\n</script>\n\n<Counter/>`,
            'lib/Counter.abide': `<script server>
import { memo } from '@abide/abide'

export const count = memo(() => ({ n: 0 }), { global: true })
</script>

<button onclick={() => count()}>read</button>`,
            'lib/board.server.ts': `import { memo } from '@abide/abide'
import { rpc } from '@abide/abide/server'

export const board = rpc(memo(() => ({ n: 0 }), { global: true }), {
    methods: ['GET', 'PATCH'],
})
export const theme = rpc({ mode: 'dark' })
`,
        }),
    )
    const answered: string[] = []
    for (const mount of mounts)
        if (/\/(count|board|theme)$/.test(mount.address))
            answered.push(`${mount.method} ${mount.address}`)
    expect(answered.sort()).toEqual([
        'GET /__abide/handlers/lib/Counter/count',
        'GET /lib/board/board',
        'GET /lib/board/theme',
        'PATCH /lib/board/board',
    ])
    expect(files['lib/Counter.abide']?.client ?? '').toContain(
        'const count = __wire("GET"',
    )
    const face = handlers['lib/board.server.ts']?.client ?? ''
    expect(face).toContain('export const board = __wire(["GET","PATCH"]')
    expect(face).toContain('"faces":{"patch":"PATCH"}')
    expect(face).toContain('export const theme = __wire("GET"')
})

// 16.70, 34.17 — EVERY NAME A SERVER BLOCK DECLARES AND EXPORTS IS ANSWERED, a generator's as much as
// a value's: the names the build mounts are the ones the block's export was wrapped as an `rpc` at.
// THE REVERT: read the names off a second walk that resets on `function*`'s `*`; `ticks` and `more`
// answer at no address, and the mounts are `[plain, value]`.
test('a server block exporting a generator answers it at its private address — 16.70, 34.17', async () => {
    const { mounts } = await compileApp(
        appFixture({
            'index.abide': `<script server>
export const value = 1
export async function plain() { return 1 }
export async function* ticks() { yield 1 }
export function* more() { yield 2 }
</script>

<p>home</p>`,
        }),
    )
    const answered: string[] = []
    for (const mount of mounts)
        if (mount.address.startsWith('/__abide/handlers/'))
            answered.push(
                mount.address.slice(mount.address.lastIndexOf('/') + 1),
            )
    expect(answered.sort()).toEqual(['more', 'plain', 'ticks', 'value'])
})

// 34.22 — ONE FILE, ONE MODULE SCOPE ON THE SERVER: a server block importing a name its `<script>`
// imports is the one binding, which the browser's module carries alone — binding by binding, so a
// statement importing one name both blocks use and one only the server does keeps the second.
// THE REVERT: drop `shared` from `projectShadow`'s server blocks; the check reports `reactive` a
// duplicate identifier twice.
test('a server block importing what its <script> imports compiles as one binding — 34.22', async () => {
    const root = appFixture({
        'index.abide': `<script server>
import { reactive, refuse } from '@abide/abide'

export const count = ({ n }: { n: number }) => (n > 0 ? reactive(n)() : refuse(400))
</script>

<script>
import { reactive } from '@abide/abide'

let n = reactive(2)
</script>

<p>{n}</p>`,
    })
    const found = await checkApp(root)
    expect(found.filter((one) => one.category === 'error')).toEqual([])
    const { files } = await compileApp(root)
    const server = files['index.abide']?.server ?? ''
    expect(server.split("import { reactive } from '@abide/abide'").length).toBe(
        2,
    )
    // What only the server block imports is all of its statement that is left.
    expect(server).toContain("import { refuse } from '@abide/abide'")
    expect(files['index.abide']?.client).toContain(
        "import { reactive } from '@abide/abide'",
    )
})

// 34.22 — A TYPE-ONLY IMPORT NEVER STANDS FOR A VALUE ONE: the zod pattern imports the schema's type
// into the `<script>` and the schema itself into the server block. THE REVERT: key a binding with
// its `type` modifier stripped in `projectShadow`; the server module imports no `Contact` and the
// check reports TS1361.
test('a type-only import in the <script> leaves the server block its value import — 34.22', async () => {
    const root = appFixture({
        'lib/schema.ts': `export const Contact = { parse: (value: unknown) => value }
export type Contact = { name: string }`,
        'index.abide': `<script>
import type { Contact } from './lib/schema.ts'

const empty: Contact = { name: '' }
</script>

${SERVED("import { Contact } from './lib/schema.ts'\n\nexport const save = (a: unknown) => Contact.parse(a)")}
<p>{empty.name}</p>`,
    })
    const found = await checkApp(root)
    expect(found.filter((one) => one.category === 'error')).toEqual([])
    const { files } = await compileApp(root)
    expect(files['index.abide']?.server ?? '').toMatch(
        /import \{ Contact \} from '\.\/lib\/schema\.ts'/,
    )
})

// 34.22, 34.16 — A `.abide`'s DEFAULT IS TWO FACES, the module to a `<script>` and a bound function
// to a server block, and one name in one module scope cannot hold both. THE REVERT: drop the
// `.abide` refusal in `projectShadow`; the build passes and the handler's `Card(…)` is the module.
test('a .abide default both a server block and its <script> import is refused — 34.22', async () => {
    const refused = await refusal(
        compileApp(
            appFixture({
                'lib/Card.abide': '<p>card</p>',
                'index.abide': `${SERVED("import Card from './lib/Card.abide'\n\nexport const preview = () => Card({})")}
<script>
import Card from './lib/Card.abide'
</script>

<Card />`,
            }),
        ),
    )
    expect(refused).toContain('34.22')
    expect(refused).toContain('Card')
})

// 34.22 — WHAT IS LEFT OF A SHARED STATEMENT IS READ OFF ITS TOKENS, never its collapsed text: a
// `//` comment in a multi-line import ran to the end of the one line it was folded into. THE
// REVERT: rebuild the kept statement from `importStatements`' collapsed text; the server module
// does not parse.
test('a comment inside a shared multi-line import leaves a server module that parses — 34.22', async () => {
    const root = appFixture({
        'lib/x.ts': 'export const a = 1\nexport const b = 2',
        'index.abide': `${SERVED(`import {
    a, // note
    b,
} from './lib/x.ts'

const sum = () => a + b`)}
<script>
import { a } from './lib/x.ts'
</script>

<p>{a}</p>`,
    })
    const { files } = await compileApp(root)
    const server = files['index.abide']?.server ?? ''
    expect(() =>
        new Bun.Transpiler({ loader: 'ts' }).scan(server),
    ).not.toThrow()
    expect(server).toMatch(/import \{ b \} from '\.\/lib\/x\.ts'/)
})

// 34.22 — A DEFAULT IS ONE BINDING LIKE ANY OTHER, merged where a statement also names more. THE
// REVERT: compare a statement holding a default by its whole text; the check reports `X` a
// duplicate identifier.
test('a default import both blocks make merges beside the names only one makes — 34.22', async () => {
    const root = appFixture({
        'lib/x.ts': 'export default 1\nexport const y = 2',
        'index.abide': `${SERVED("import X, { y } from './lib/x.ts'\n\nexport const total = () => X + y")}
<script>
import X from './lib/x.ts'
</script>

<p>{X}</p>`,
    })
    const found = await checkApp(root)
    expect(found.filter((one) => one.category === 'error')).toEqual([])
    const { files } = await compileApp(root)
    const server = files['index.abide']?.server ?? ''
    expect(server.split("import X from './lib/x.ts'").length).toBe(2)
    expect(server).toMatch(/import \{ y \} from '\.\/lib\/x\.ts'/)
})

// 16.74 — A HANDLER IMPORTED FROM A HANDLER FILE IS TYPED, so what its call answers reads by name as
// any `.ts` module's would. THE REVERT: type a handler file's import through the wildcard
// declaration rather than the file itself; the read is refused.
test("a page reads a handler file's answer by name, typed — 16.74", async () => {
    const found = await checkApp(
        appFixture({
            'getPolicy.server.ts':
                "import { rpc } from '@abide/abide/server'\n\nexport default rpc(() => ({ retries: 3 }))\n",
            'index.abide': `<script>
import { reactive } from '@abide/abide'
import getPolicy from './getPolicy.server.ts'

const policy = reactive(() => getPolicy())
const retries: number = policy.retries
</script>

<p>{retries}</p>`,
        }),
    )
    expect(found.filter((diagnosis) => diagnosis.category === 'error')).toEqual(
        [],
    )
}, 60_000)

// 20.13 — the method, then the route, brackets dropped. THE REVERT: name by the path alone;
// `post_media_id` reads `media_id`, the GET's name.
test('a handler is named on MCP and OpenAPI by its method and its route — 20.13', () => {
    expect(surfaceName('GET', '/media/[id]')).toBe('get_media_id')
    expect(surfaceName('POST', '/media/[id]')).toBe('post_media_id')
    expect(surfaceName('GET', '/files/[...rest]')).toBe('get_files_rest')
    expect(surfaceName('GET', '/')).toBe('get')
})

// THE REVERT: name the tool by `rpc.address` as it stands — under `/docs` it reads
// `post_docs_figures_draw` where `post_figures_draw` is due.
test('rpc.tool is the name MCP lists the handler by, under a mount too — 20.24', () => {
    const draw = rpc(({ shape }: { shape: string }) => shape, {
        methods: ['POST'],
    })
    expect(draw.tool).toBeUndefined()
    draw.address = '/figures/draw'
    expect(draw.tool).toBe('post_figures_draw')
    const standing = MOUNT.current
    MOUNT.current = () => '/docs'
    try {
        draw.address = '/docs/figures/draw'
        expect(draw.tool).toBe('post_figures_draw')
        const read = rpc(({ id }: { id: number }) => id)
        read.address = '/docs/media/[id]'
        expect(read.tool).toBe('get_media_id')
    } finally {
        MOUNT.current = standing
    }
})

// 16.9 — a parameter rides in the path and leaves the args, whatever the method. THE REVERT: drop
// the `address.includes('[')` branch from `rpcRequest`; the URL keeps `[id]` and the body `id`.
test('a call writes its route parameters into the path — 16.9', () => {
    const read = rpcRequest('GET', '/media/[id]/read', { id: 7, size: 'large' })
    expect(read.url).toBe('/media/7/read?size=large')
    const write = rpcRequest('POST', '/media/[id]/save', { id: 7, title: 'x' })
    expect(write.url).toBe('/media/7/save')
    expect(write.body).toBe('{"title":"x"}')
})

// THE SERVED APP, for what only answers over the wire: a parameter reaching a handler (16.65), one
// sent twice (16.66), the most specific route answering the method (19.20), a 405 naming what is
// answered (15.17), a public directory mounted by the path above it (36.11), and the hooks a route
// files (37.2, 37.5).
let base = ''
let stop = (): void => {}

beforeAll(async () => {
    const fixture = appFixture({
        'index.abide': '<p>home</p>',
        'media/[id]/index.abide': '<p id="page">a film</p>',
        'media/new.server.ts': `import { rpc } from '@abide/abide/server'\n\nexport default rpc(({ title }: { title: string }) => ({ made: title }), { methods: ['POST'] })\n`,
        'media/[id]/note.server.ts': `import { rpc } from '@abide/abide/server'\n\nexport default rpc(({ id, note }: { id: number; note: string }) => ({ id, note }), { methods: ['POST'] })\n`,
        'media/[id]/read.server.ts': `import { rpc } from '@abide/abide/server'\n\nexport default rpc(({ id }: { id: number }) => ({ id, type: typeof id }))\n`,
        'media/public/poster.txt': 'a poster',
        // 35.2 — an error page answers for its own route and what lies below it.
        'shelf/error.abide': '<p id="error">the shelf</p>',
        'shelf/[id]/error.abide': '<p id="error">one book</p>',
        'shelf/[id]/index.abide': '<p>a book</p>',
        'shelf/new.abide':
            "<script>\nthrow new Error('no new books')\n</script>\n\n<p>new</p>",
        // 37.2, 37.5 — a guard over `/vault` and what is below it, and the errors there.
        'vault/layout.abide': `<script server>
import { middleware, onError } from '@abide/abide/server'
import { seen } from './lib/seen.server.ts'

middleware((next, { request }) =>
    request.headers.get('x-key') === 'open' ? next() : new Response('locked', { status: 401 }),
)
onError((error) => void seen.push(\`vault: \${(error as Error).message}\`))
</script>
`,
        'vault/index.abide': '<p>vault</p>',
        'vault/gold.server.ts': `import { rpc } from '@abide/abide/server'\n\nexport default rpc(() => 'gold')\n`,
        'vault/blowUp.server.ts': `import { rpc } from '@abide/abide/server'\n\nexport default rpc(() => {
    throw new Error('the vault blew up')
})
`,
        'vault/lib/seen.server.ts': 'export const seen: string[] = []\n',
        // 30.3, 15.8 — a render calling a handler with a path parameter no address carries, and
        // painting its refusal, beside a count of the handler's runs.
        'comments/[id]/getComments.server.ts': `import { rpc } from '@abide/abide/server'
import { runs } from '../../lib/runs.server.ts'

export default rpc(({ id }: { id: string }) => {
    runs.count += 1
    return [id]
})
`,
        'lib/runs.server.ts': 'export const runs = { count: 0 }\n',
        'commentRuns.server.ts': `import { rpc } from '@abide/abide/server'
import { runs } from './lib/runs.server.ts'

export default rpc(() => runs.count, { methods: ['POST'] })
`,
        'uncommented/index.abide': `<script>
import { reactive } from '@abide/abide'
import getComments from '../comments/[id]/getComments.server.ts'

const blank = reactive(() => getComments({ id: '' }))
</script>

<p id="refused">{blank.error()?.name} {blank.error()?.status}</p>`,
        // 37.2 — a rung below the root handing `next` a request of its own.
        'lobby/layout.abide': `<script server>
import { middleware } from '@abide/abide/server'

middleware((next, { request }) => {
    const headers = new Headers(request.headers)
    headers.set('x-badge', 'issued')
    headers.set('cookie', 'pass=granted')
    return next({ request: new Request(request, { headers }) })
})
</script>
`,
        'lobby/index.abide': '<p>lobby</p>',
        'lobby/badge.server.ts': `import { cookies, request, rpc } from '@abide/abide/server'

export default rpc(() => ({
    header: request().headers.get('x-badge'),
    cookie: cookies().get('pass') ?? null,
}))
`,
        // 16.69 — two handlers under a rest, each answering at its own name.
        'docs/[...path]/save.server.ts': `import { rpc } from '@abide/abide/server'\n\nexport default rpc(({ path }: { path: string[] }) => ({ saved: path }), { methods: ['POST'] })\n`,
        'docs/[...path]/remove.server.ts': `import { rpc } from '@abide/abide/server'\n\nexport default rpc(({ path }: { path: string[] }) => ({ removed: path }), { methods: ['POST'] })\n`,
        'errors.server.ts': `import { rpc } from '@abide/abide/server'
import { seen } from './vault/lib/seen.server.ts'

export default rpc(() => [...seen])
`,
        'boom.server.ts': `import { rpc } from '@abide/abide/server'\n\nexport default rpc(() => {
    throw new Error('the root blew up')
})
`,
        // 16.72 — a component's private handler under `admin/lib`, run under the rung `admin`'s
        // layout files, and a sibling route's rung that must not reach it.
        'admin/layout.abide': `<script server>
import { middleware } from '@abide/abide/server'

middleware((next, { request }) =>
    request.headers.get('x-staff') === 'yes' ? next() : new Response('staff only', { status: 403 }),
)
</script>
`,
        'admin/index.abide': `<script>\nimport Panel from './lib/Panel.abide'\n</script>\n\n<Panel/>`,
        'admin/lib/Panel.abide': `<script server>
export const save = () => 'saved'
</script>

<button onclick={() => save()}>save</button>`,
        'reports/layout.abide': `<script server>
import { middleware } from '@abide/abide/server'

middleware(() => new Response('reports only', { status: 418 }))
</script>
`,
        'reports/lib/Chart.abide': `<script server>
export const draw = () => 'drawn'
</script>

<button onclick={() => draw()}>draw</button>`,
        'media/lib/catalog.server.ts': `import { rpc } from '@abide/abide/server'

export const CATALOG_SECRET = 'hunter2'

export default rpc(() => 'shelf')

export const stages = rpc(() => ['lead', 'won'])
`,
        'media/lib/db.server.ts': 'export const db = 1\n',
    })
    const built = await buildApp(fixture)
    if (built.exitCode !== 0) throw new Error(built.stderr)
    ;({ base, stop } = await startApp(fixture))
}, 60_000)

// 16.73 — A SERVER FILE ANSWERS AT ITS OWN PATH WHEREVER IT STANDS, a lib directory's among them: its
// default at the path, a named `rpc` below it by its name. THE REVERT: stop `walkApp` handing a lib
// directory's server file to `handlersUnder`; both answer 404.
test("a lib directory's server file answers its rpcs at its own path — 16.73", async () => {
    const shelf = await Bun.fetch(`${base}/media/lib/catalog`)
    const stages = await Bun.fetch(`${base}/media/lib/catalog/stages`)
    expect([
        `${shelf.status} ${await shelf.text()}`,
        `${stages.status} ${await stages.text()}`,
    ]).toEqual(['200 "shelf"', '200 ["lead","won"]'])
})

afterAll(() => stop())

// 16.65 — THE PATH'S PARAMETER REACHES THE HANDLER, coerced to the type its args declare. THE
// REVERT: drop `withParameters` from `answerRpc`; the GET answers `{}` and the POST without its id.
test('a route parameter reaches the handler, typed, whatever the method — 16.65', async () => {
    const read = await Bun.fetch(`${base}/media/42/read`)
    expect(await read.json()).toEqual({ id: 42, type: 'number' })
    const written = await Bun.fetch(`${base}/media/9/note`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"note":"good"}',
    })
    expect(await written.json()).toEqual({ id: 9, note: 'good' })
})

// 16.66 — THE SAME PARAMETER TWICE is refused rather than one of the two chosen. THE REVERT: drop
// the duplicate check in `withParameters`; the query's `id` overrides the path's and answers 200.
test('a parameter in the path and the query as well is refused 400 — 16.66', async () => {
    const answer = await Bun.fetch(`${base}/media/42/read?id=7`)
    expect(answer.status).toBe(400)
})

// 19.20 — A STATIC ROUTE THAT DOES NOT ANSWER THE METHOD LEAVES IT TO ONE THAT DOES: `GET /media/new`
// is the page at `/media/[id]`, and `POST /media/new` the handler file `media/new.server.ts`. THE REVERT: stop the walk at
// the first route that matches; the GET is a 405.
test('a request reaches the most specific route answering its method — 19.20', async () => {
    const page = await Bun.fetch(`${base}/media/new`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('a film')
    const made = await Bun.fetch(`${base}/media/new`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"title":"Alien"}',
    })
    expect(await made.json()).toEqual({ made: 'Alien' })
})

// 15.17 — every method answered there, in `allow`. THE REVERT: answer `allow: GET, HEAD` as before;
// it names methods nothing answers there.
test('a method nothing answers at a route is 405, naming every method answered there — 15.17', async () => {
    const answer = await Bun.fetch(`${base}/media/9/note`, { method: 'PUT' })
    expect(answer.status).toBe(405)
    expect(answer.headers.get('allow')).toBe('POST')
})

// 36.11 — A PUBLIC DIRECTORY MOUNTS AT THE PATH ABOVE IT. THE REVERT: key `appFiles`'s public files
// by their path below `public` alone; `/media/poster.txt` is a 404 and `/poster.txt` answers.
test('a public directory is answered below the path above it — 36.11', async () => {
    const answer = await Bun.fetch(`${base}/media/poster.txt`)
    expect(answer.status).toBe(200)
    expect(await answer.text()).toBe('a poster')
})

// 37.2 — A LAYOUT'S MIDDLEWARE RUNS OVER ITS ROUTE AND WHAT IS BELOW IT, its page and the handlers
// beside it, and nowhere else. THE REVERT: drop the `rungsOver` wrap from `answerRequest`; the
// locked page and handler answer 200.
test("a layout's middleware guards its route's pages and handlers, and no other route — 37.2", async () => {
    expect((await Bun.fetch(`${base}/vault`)).status).toBe(401)
    expect((await Bun.fetch(`${base}/vault/gold`)).status).toBe(401)
    const opened = await Bun.fetch(`${base}/vault/gold`, {
        headers: { 'x-key': 'open' },
    })
    expect(await opened.json()).toBe('gold')
    expect((await Bun.fetch(`${base}/media/9`)).status).toBe(200)
})

// 15.8, 30.3, 41.20 — A RENDER'S CALL WHOSE PATH PARAMETER NO ADDRESS CARRIES IS REFUSED IN PROCESS
// as the wire refuses it, a 422 `ValidationError`, and the handler never runs: the page paints the
// refusal the browser's call reaches after hydration. THE REVERT: drop the route check from
// `rpc.ts`'s `call`; the render's early-call report has no request to build and the page answers
// 422 — and with that report guarded too, it paints no refusal and the handler ran once.
test("a render's call with no address for its path parameter is refused in process, the handler unrun — 15.8, 30.3", async () => {
    const page = await Bun.fetch(`${base}/uncommented`)
    const painted = /<p id="refused">([^<]*)<\/p>/.exec(await page.text())?.[1]
    const runs = await Bun.fetch(`${base}/commentRuns`, { method: 'POST' })
    expect(
        `${page.status} ${painted?.trim()}, runs: ${await runs.json()}`,
    ).toBe('200 ValidationError 422, runs: 0')
})

// 37.2, 37.3 — A RUNG BELOW THE ROOT THAT HANDS `next` A REQUEST OF ITS OWN is adopted as a root
// rung's is, so `request` and `cookies` read the request it handed on. THE REVERT: drop the
// `adoptRequest` from `answerMatched`; the handler reads `{ header: null, cookie: null }`.
test("a route rung's own request is the one the handler reads — 37.2, 37.3", async () => {
    const answer = await Bun.fetch(`${base}/lobby/badge`)
    expect(await answer.json()).toEqual({ header: 'issued', cookie: 'granted' })
})

// 35.2 — AN ERROR PAGE IS RESOLVED AS A LAYOUT IS, by the route the request matched: `[id]`'s does
// not cover `/shelf/new`, though `[id]` would match `new` as an address. THE REVERT: resolve
// `errorsFor` by the path alone, as for an address no route matched; `/shelf/new` paints `one book`.
test("a failing page paints its own route's nearest error page, not a sibling's — 35.2", async () => {
    const answer = await Bun.fetch(`${base}/shelf/new`)
    expect(answer.status).toBe(500)
    const body = await answer.text()
    expect(body).toContain('the shelf')
    expect(body).not.toContain('one book')
})

// 37.5 — AN ERROR IN A ROUTE REACHES THE `onError` ITS ROUTE FILED, and one elsewhere does not. THE
// REVERT: hand every `onError` every error in `handOnError`; the error at `/` is the vault's too.
test("an unexpected error reaches the onError its route filed, and no other route's — 37.5", async () => {
    const thrown = await Bun.fetch(`${base}/vault/blowUp`, {
        headers: { 'x-key': 'open' },
    })
    expect(thrown.status).toBe(500)
    expect((await Bun.fetch(`${base}/boom`)).status).toBe(500)
    const seen = await (await Bun.fetch(`${base}/errors`)).json()
    expect(seen).toEqual(['vault: the vault blew up'])
})

// 16.72 — A PRIVATE HANDLER RUNS UNDER THE RUNGS ITS FILE'S HOOKS ARE FILED AT: `admin/lib/Panel.abide`
// is filed at `/admin` (37.1), so `admin/layout.abide`'s guard refuses it and admits it, and the
// sibling `/reports` rung, which refuses everything it covers, never sees it — though it does see
// `reports/lib/Chart.abide`'s. THE REVERT: mount a private handler at its address's own scope in
// `handlersUnder` (`scope: address`); no layout's rung covers `/__abide/handlers/…`, and the
// unbadged save answers 200 where 403 is due, the chart 200 where 418 is.
test('a private handler runs under the middleware its file is filed at, and no sibling route’s — 16.72', async () => {
    const save = (headers: Record<string, string>) =>
        Bun.fetch(`${base}/__abide/handlers/admin/lib/Panel/save`, {
            headers: { origin: base, ...headers },
        })
    const refused = await save({})
    const admitted = await save({ 'x-staff': 'yes' })
    const chart = await Bun.fetch(
        `${base}/__abide/handlers/reports/lib/Chart/draw`,
        { headers: { origin: base } },
    )
    expect({
        refused: refused.status,
        admitted: [admitted.status, await admitted.json()],
        chart: chart.status,
    }).toEqual({ refused: 403, admitted: [200, 'saved'], chart: 418 })
})

// 16.71 — A PRIVATE HANDLER IS LISTED NOWHERE: not on OpenAPI, not on MCP, though it answers at its
// address (16.72 above), while a handler file is listed on both. THE REVERT: drop the
// `mount.private` return from `surfaceOf`; both private handlers are OpenAPI paths and MCP tools,
// four entries where none is due.
test('a private handler is on neither the OpenAPI document nor the MCP listing — 16.71', async () => {
    const openapi = (await (
        await Bun.fetch(`${base}/__abide/openapi.json`)
    ).json()) as { paths: Record<string, unknown> }
    const paths = Object.keys(openapi.paths)
    const listed = (await (
        await Bun.fetch(`${base}/__abide/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
            }),
        })
    ).json()) as { result: { tools: { name: string }[] } }
    const tools = listed.result.tools.map((tool) => tool.name)
    expect(paths).toContain('/media/new')
    expect(tools).toContain('post_media_new')
    expect(paths.filter((path) => path.includes('handlers'))).toEqual([])
    expect(
        tools.filter(
            (tool) => tool.includes('handlers') || tool.includes('Panel'),
        ),
    ).toEqual([])
})

// 19.28, 19.29 — A MUTATION'S BROWSER COPY HOLDS THE DOCUMENT ITS ARGS ARE CHECKED BY, which is the one
// its declared `jsonSchema` is written as where it is a literal, bound to a name first: what a `form`
// checks a submit against before the call (56.2). A `GET`'s copy holds none. THE REVERT: drop
// `declaredDocument` from the build's args; the copy holds the type's document, with no `minLength`.
test("a mutation's browser copy holds its declared literal document, and a GET's holds none — 19.28, 19.29", async () => {
    const { handlers } = await compileApp(
        appFixture({
            'deals/createDeal.server.ts': `import { jsonSchema } from '@abide/abide'
import { rpc } from '@abide/abide/server'

const NEW_DEAL = jsonSchema<{ company: string; amount: number }>({
    type: 'object',
    required: ['company', 'amount'],
    properties: {
        company: { type: 'string', minLength: 2 },
        amount: { type: 'number', minimum: 1_000 },
    },
})

export default rpc(({ company }: { company: string; amount: number }) => company, { methods: ['POST'],
    args: NEW_DEAL,
})
`,
            'deals/getDeal.server.ts': `import { rpc } from '@abide/abide/server'

export default rpc(({ id }: { id: string }) => id)
`,
        }),
    )
    const face = (name: string) =>
        Object.entries(handlers).find(([path]) =>
            path.endsWith(`${name}.server.ts`),
        )?.[1]
    const declared = {
        type: 'object',
        required: ['company', 'amount'],
        properties: {
            company: { type: 'string', minLength: 2 },
            amount: { type: 'number', minimum: 1000 },
        },
    }
    expect(face('createDeal')?.exports.default?.args).toEqual(declared)
    expect(face('createDeal')?.client).toContain(JSON.stringify(declared))
    expect(face('getDeal')?.exports.default?.args).toBeDefined()
    expect(face('getDeal')?.client).not.toContain('"properties"')
})

// 16.2, 16.113 — A SERVER FILE ANSWERS EACH `rpc` IT EXPORTS: its default at its route, a named one
// below it by its name, and one declaring `address` there; what it exports beside them answers
// nothing. THE REVERTS: address every export at the file's route in `handlersUnder`; `stages` and
// `/media/getGrid` collide (20.13). Drop `declaredAddress` from `declaredExports`; `v1` answers at
// `/media/getGrid/v1`.
test('a server file answers its default at its route, each named rpc below it, and an address where it says — 16.2, 16.113', async () => {
    const { mounts } = await compileApp(
        appFixture({
            'index.abide': '<p>home</p>',
            'media/getGrid.server.ts': `import { rpc } from '@abide/abide/server'

const DB = { rows: [1, 2] }
export default rpc(() => DB.rows)
export const stages = rpc(() => ['lead', 'won'])
export const v1 = rpc(() => DB.rows, { address: '/api/v1/grid' })
export const save = rpc(() => 1, { methods: ['POST'] })
export const db = DB
`,
        }),
    )
    const addresses: string[] = []
    for (const mount of mounts)
        addresses.push(`${mount.method} ${mount.address} ${mount.export}`)
    expect(addresses.sort()).toEqual([
        'GET /api/v1/grid v1',
        'GET /media/getGrid default',
        'GET /media/getGrid/stages stages',
        'POST /media/getGrid/save save',
    ])
})
