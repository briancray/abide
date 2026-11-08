// 38.108 — `abide routes`: every address an app answers with the file answering it, its private
// handlers marked, and every hook with the route it is filed at — as text, and with `--json` as one
// document. Spawned, as an author runs it, over an app holding one of each.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { spawned } from '@abide/harness/gate'

import { appFixture, BIN } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

let app = ''

beforeAll(() => {
    app = appFixture({
        'index.abide': '<main>home</main>',
        'media/ID.param.ts': 'export const ID = /\\d+/',
        'media/[id=ID].abide': `<script>
import { props } from '@abide/abide'

const { params } = props<{ params: { id: string } }>()
</script>

<main>{params.id}</main>`,
        // 37.1 — a hook a handler file calls is filed at that handler's own route, a member call
        // of abide's as much as a bare one. THE REVERT: skip a name after a `.` in `hookCalls`;
        // the middleware leaves the map.
        'media/getGrid.handler.ts': `import * as server from '@abide/abide/server'

server.middleware((next) => next())

export default server.GET(() => [1, 2])
`,
        // 38.135 — a handler's own rungs, named as written: a call, a spread, a name, inline.
        'media/lib/homeAccess.ts': `import type { Middleware } from '@abide/abide'

export const homeAccess = (): Middleware[] => [(next) => next()]
export const audited: Middleware = (next) => next()
`,
        'media/saveGrid.handler.ts': `import { POST } from '@abide/abide/server'
import { audited, homeAccess } from './lib/homeAccess.ts'

export default POST(() => 'saved', {
    middleware: [...homeAccess(), audited, (next) => next()],
})
`,
        'media/dropGrid.handler.ts': `import { DELETE } from '@abide/abide/server'
import { homeAccess } from './lib/homeAccess.ts'

const OPTIONS = { middleware: homeAccess() }

export default DELETE(() => 'dropped', OPTIONS)
`,
        'media/openGrid.handler.ts': `import { PUT } from '@abide/abide/server'
import { homeAccess } from './lib/homeAccess.ts'

export default PUT(() => 'opened', { middleware: homeAccess() })
`,
        // 16.70 — declared, not exported: the component's own, answered below `/__abide/handlers/`.
        'media/lib/Card.abide': `<script server>
import { POST } from '@abide/abide/server'

const save = POST(() => 'saved')
</script>

<button onclick={() => save()}>save</button>`,
    })
})

afterAll(removeTemporaryModules)

// THE REVERT: answer `kind: 'handler'` for every mount in `appMap`; the private handler reads
// `handler`, and the text loses its `(private)`. Drop `matchers` from `appMap`'s rows; the page
// names `ID` with nothing saying what it takes. 38.135 — answer `[]` from `rungsNamed`; the three
// guarded handlers read as carrying no rungs, `saveGrid`'s three names and `dropGrid`'s unread lost.
test("abide routes --json lists every route, the private handler marked, each handler's rungs, and every hook — 38.108, 38.135", async () => {
    const ran = await spawned(['bun', BIN, 'routes', '--root', app, '--json'])
    expect(ran.exitCode, ran.stderr).toBe(0)
    expect(JSON.parse(ran.stdout)).toEqual({
        routes: [
            {
                method: 'GET',
                address: '/',
                file: 'index.abide',
                kind: 'page',
                matchers: {},
                middleware: [],
            },
            {
                method: 'POST',
                address: '/__abide/handlers/media/lib/Card/save',
                file: 'media/lib/Card.abide',
                kind: 'private',
                matchers: {},
                middleware: [],
            },
            {
                method: 'GET',
                address: '/media/[id=ID]',
                file: 'media/[id=ID].abide',
                kind: 'page',
                matchers: { ID: '^(?!\\.\\.?$)(?:\\d+)$' },
                middleware: [],
            },
            {
                method: 'DELETE',
                address: '/media/dropGrid',
                file: 'media/dropGrid.handler.ts',
                kind: 'handler',
                matchers: {},
                middleware: null,
            },
            {
                method: 'GET',
                address: '/media/getGrid',
                file: 'media/getGrid.handler.ts',
                kind: 'handler',
                matchers: {},
                middleware: [],
            },
            {
                method: 'PUT',
                address: '/media/openGrid',
                file: 'media/openGrid.handler.ts',
                kind: 'handler',
                matchers: {},
                middleware: ['homeAccess'],
            },
            {
                method: 'POST',
                address: '/media/saveGrid',
                file: 'media/saveGrid.handler.ts',
                kind: 'handler',
                matchers: {},
                middleware: ['homeAccess', 'audited', '<inline>'],
            },
        ],
        hooks: [
            {
                hook: 'middleware',
                route: '/media/getGrid',
                file: 'media/getGrid.handler.ts',
            },
        ],
    })
}, 30_000)

// The same map as text: one line an address, the private one marked, then the hooks.
test('abide routes prints the same map as text — 38.108', async () => {
    const ran = await spawned(['bun', BIN, 'routes', '--root', app])
    expect(ran.exitCode, ran.stderr).toBe(0)
    const lines = ran.stdout.trimEnd().split('\n')
    expect(lines.slice(0, 7).map((line) => line.split(/\s+/))).toEqual([
        ['GET', '/', 'index.abide'],
        [
            'POST',
            '/__abide/handlers/media/lib/Card/save',
            'media/lib/Card.abide',
            '(private)',
        ],
        ['GET', '/media/[id=ID]', 'media/[id=ID].abide'],
        [
            'DELETE',
            '/media/dropGrid',
            'media/dropGrid.handler.ts',
            'middleware:',
            'unread',
        ],
        ['GET', '/media/getGrid', 'media/getGrid.handler.ts'],
        [
            'PUT',
            '/media/openGrid',
            'media/openGrid.handler.ts',
            'middleware:',
            'homeAccess',
        ],
        [
            'POST',
            '/media/saveGrid',
            'media/saveGrid.handler.ts',
            'middleware:',
            'homeAccess,',
            'audited,',
            '<inline>',
        ],
    ])
    expect(lines.slice(7)).toEqual([
        '',
        'matchers',
        `  ID  /^(?!\\.\\.?$)(?:\\d+)$/`,
        '',
        'hooks',
        expect.stringMatching(
            /^ {2}middleware\s+\/media\/getGrid\s+media\/getGrid\.handler\.ts$/,
        ),
    ])
}, 30_000)
