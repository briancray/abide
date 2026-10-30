// 23.3, 23.9, 23.19, 27.13, 30.26, 38.108 — ONE LAYOUT OF THE APP, read by every reader: the build's
// routes, the checker's `Routes`, an editor's one file and `abide routes` each take a file's place,
// kind, route and hooks from `appLayout` rather than asking its path again, so none of them can
// answer a question about one file differently from another.

import { afterAll, expect, test } from 'bun:test'
import { realpathSync } from 'node:fs' // bun exposes no sync realpath of its own

import { appMap } from '#compiler/appMap.ts'
import { checkApp, checkSource } from '#compiler/checkApp.ts'
import { openChecker } from '#compiler/compileApp.ts'
import type { Diagnosis } from '#compiler/TypeSession.ts'

import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

const KIT = {
    'node_modules/admin-kit/package.json': JSON.stringify({
        name: 'admin-kit',
        type: 'module',
    }),
    'node_modules/admin-kit/admin/users/[id]/index.abide': `<script>
import { route } from '@abide/abide'

const id: string = route.params().id
</script>

<p>{id}</p>`,
    'node_modules/admin-kit/admin/users/list.handler.ts': `import { GET, middleware } from '@abide/abide/server'

middleware((next) => next())

export default GET(() => ['ada'])
`,
}

const MOUNTING = {
    'index.abide': '<p>home</p>',
    'tools/layout.abide': `<script module>
import 'admin-kit/admin' with { type: 'routes' }
</script>

<section><slot/></section>
`,
}

// 23.3, 30.26 — A PAGE WITH NOTHING TO PAINT IS NO ROUTE, to the checker's `Routes` as to the build's
// table, so a link to it is refused where the server would answer it with a 404. THE REVERT: add
// every `page` to `addresses` in `appLayout`, painting or not; the link is accepted, 0 findings where
// 1 is due.
test("a hooks-only page is no route to the checker's Routes — 23.3, 30.26", async () => {
    const found = await checkApp(
        appFixture({
            'index.abide': `<script>
import { url } from '@abide/abide'

const hooked = url('/hooked')
</script>

<a href={hooked}>hooked</a>`,
            'hooked/index.abide': `<script server>
import { middleware } from '@abide/abide/server'

middleware((next) => next())
</script>`,
        }),
    )
    expect(errorCodes(found)).toEqual([2345])
}, 60_000)

// 23.9, 23.19 — AN EDITOR'S MOUNTED PAGE IS TYPED BY THE ROUTE ITS MOUNT GIVES IT, as `abide check`
// types it. THE REVERT: place the file at its own path in `checkSource` (`placement(relative(root,
// path))` whatever the layout holds); it reads as a dependency's component, `id` is no longer text,
// and the check reports TS2322, 1 finding where 0 are due.
test("an editor's mounted page reads route.params by its mount's route — 23.9, 23.19", async () => {
    const app = realpathSync(appFixture({ ...MOUNTING, ...KIT }))
    const page = `${app}/node_modules/admin-kit/admin/users/[id]/index.abide`
    const checker = await openChecker(app)
    try {
        const found = await checkSource(
            checker,
            page,
            await Bun.file(page).text(),
        )
        expect(errorCodes(found)).toEqual([])
    } finally {
        await checker.close()
    }
}, 60_000)

// 38.108 — `abide routes` LISTS A MOUNTED HANDLER'S HOOK at the route its mount gives it, as the
// server files it (37.2). THE REVERT: list the hooks of the app's own handler files alone in
// `appMap`, as its walk once did; the middleware leaves the map, 0 hooks where 1 is due.
test("abide routes lists a mounted handler file's hooks at its mount — 38.108, 23.19", async () => {
    const { hooks } = await appMap(appFixture({ ...MOUNTING, ...KIT }))
    expect(hooks).toEqual([
        {
            hook: 'middleware',
            route: '/tools/users/list',
            file: 'node_modules/admin-kit/admin/users/list.handler.ts',
        },
    ])
}, 60_000)

// 37.1, 38.108 — A HOOK IS WHAT ABIDE HANDED THE MODULE: `emitter.onError(…)` in a handler file
// importing abide for `GET` is the emitter's method, listed nowhere. THE REVERT: count a member call
// whatever it is a member of in `hookCalls`; the map lists `onError`, 1 hook where 0 are due.
test('a member call of an abide hook name on something else is no hook — 37.1, 38.108', async () => {
    const { hooks } = await appMap(
        appFixture({
            'media/getGrid.handler.ts': `import { GET } from '@abide/abide/server'

const emitter = { onError: (_: () => void) => {} }
emitter.onError(() => {})

export default GET(() => [1, 2])
`,
        }),
    )
    expect(hooks).toEqual([])
}, 60_000)

// 27.13 — AN `onConfig` STANDING AT A HANDLER FILE'S TOP LEVEL TYPES `Config`, however it is
// indented: the statement is read off the tokens, as the checker reads it, not off the start of a
// line. THE REVERT: bind only calls written at a line's first column in `moduleConfigShadow`, as its
// regex once did; `RETRIES` reads `unknown`, TS2322, 1 finding where 0 are due.
test('an indented top-level onConfig in a handler file types Config — 27.13', async () => {
    const found = await checkApp(
        appFixture({
            'media/getGrid.handler.ts': `import { config, GET, onConfig } from '@abide/abide/server'

    onConfig(() => ({ RETRIES: 3 }))

export default GET(() => {
    const retries: number = config().RETRIES
    return retries
})
`,
        }),
    )
    expect(errorCodes(found)).toEqual([])
}, 60_000)

function errorCodes(found: readonly Diagnosis[]): number[] {
    const codes: number[] = []
    for (const diagnosis of found)
        if (diagnosis.category === 'error') codes.push(diagnosis.code)
    return codes
}
