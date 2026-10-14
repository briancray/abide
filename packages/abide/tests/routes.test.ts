// 38.108 — `abide routes`: every address an app answers with the file answering it, its private
// handlers marked, and every hook with the route it is filed at — as text, and with `--json` as one
// document. Spawned, as an author runs it, over an app holding one of each.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawned } from 'harness/gate'
import { appFixture, BIN } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

let app = ''

beforeAll(() => {
    app = appFixture({
        'index.abide': '<main>home</main>',
        'media/[id].abide': `<script>
import { props } from '@abide/abide'

const { params } = props<{ params: { id: string } }>()
</script>

<main>{params.id}</main>`,
        // 37.1 — a hook a handler file calls is filed at that handler's own route, a member call
        // of abide's as much as a bare one. THE REVERT: skip a name after a `.` in `hookCalls`;
        // the middleware leaves the map.
        'media/getGrid.ts': `import * as server from '@abide/abide/server'

server.middleware((next) => next())

export default server.GET(() => [1, 2])
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
// `handler`, and the text loses its `(private)`.
test('abide routes --json lists every route, the private handler marked, and every hook — 38.108', async () => {
    const ran = await spawned(['bun', BIN, 'routes', '--root', app, '--json'])
    expect(ran.exitCode, ran.stderr).toBe(0)
    expect(JSON.parse(ran.stdout)).toEqual({
        routes: [
            { method: 'GET', address: '/', file: 'index.abide', kind: 'page' },
            {
                method: 'POST',
                address: '/__abide/handlers/media/lib/Card/save',
                file: 'media/lib/Card.abide',
                kind: 'private',
            },
            {
                method: 'GET',
                address: '/media/[id]',
                file: 'media/[id].abide',
                kind: 'page',
            },
            {
                method: 'GET',
                address: '/media/getGrid',
                file: 'media/getGrid.ts',
                kind: 'handler',
            },
        ],
        hooks: [
            {
                hook: 'middleware',
                route: '/media/getGrid',
                file: 'media/getGrid.ts',
            },
        ],
    })
}, 30_000)

// The same map as text: one line an address, the private one marked, then the hooks.
test('abide routes prints the same map as text — 38.108', async () => {
    const ran = await spawned(['bun', BIN, 'routes', '--root', app])
    expect(ran.exitCode, ran.stderr).toBe(0)
    const lines = ran.stdout.trimEnd().split('\n')
    expect(lines.slice(0, 4).map((line) => line.split(/\s+/))).toEqual([
        ['GET', '/', 'index.abide'],
        [
            'POST',
            '/__abide/handlers/media/lib/Card/save',
            'media/lib/Card.abide',
            '(private)',
        ],
        ['GET', '/media/[id]', 'media/[id].abide'],
        ['GET', '/media/getGrid', 'media/getGrid.ts'],
    ])
    expect(lines.slice(4)).toEqual([
        '',
        'hooks',
        expect.stringMatching(
            /^ {2}middleware\s+\/media\/getGrid\s+media\/getGrid\.ts$/,
        ),
    ])
}, 30_000)
