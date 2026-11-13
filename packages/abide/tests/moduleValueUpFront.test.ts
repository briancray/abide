// 41.34 AND 11.67 — A MODULE'S VALUE WHOSE BUILD STARTED A CALL IS BUILT IN THE RENDER'S SETUP, as a
// browser builds it at import. Built where the markup first reads it instead, the call started
// halfway through the build: a region the page built inline painted it in flight, and a child 41.28
// built after the turn painted it landed — one page carrying two answers, and whichever the browser
// holds, the other's regions are rebuilt at hydration (41.24).

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { handlerFiles, serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

// `whoami` lands a microtask after it starts, inside the turn a render lets run after setup.
const HANDLERS = `import { GET } from '@abide/abide/server'

export const whoami = GET(async () => {
    await Promise.resolve()
    return { owner: true }
})

export const getTick = GET(async () => {
    await Promise.resolve()
    return 1
})
`

const ME = `import { reactive } from '@abide/abide'
import whoami from '#src/who/whoami.handler.ts'

export const me = reactive(() => whoami())
`

const CAN_EDIT = `import { reactive } from '@abide/abide'
import { me } from './me.ts'

export const canEdit = reactive(() => me.ready() && me().owner)
`

// The child's setup makes a call, so 41.28 builds it after the turn.
const DEFERRED = `<script>
import { reactive } from '@abide/abide'
import getTick from '#src/who/getTick.handler.ts'
import { canEdit } from './canEdit.ts'

const tick = reactive(() => getTick())
</script>

<b id="deferred">{canEdit() ? 'edit' : 'view'}</b><i>{tick.busy() ? 0 : tick()}</i>`

const PAGE = `<script>
import Deferred from '../lib/Deferred.abide'
import { canEdit } from '../lib/canEdit.ts'
</script>

<main><p id="inline">{canEdit() ? 'edit' : 'view'}</p><Deferred /></main>`

let stop = (): void => {}
let base = ''

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'owner/index.abide': PAGE,
        'lib/Deferred.abide': DEFERRED,
        'lib/me.ts': ME,
        'lib/canEdit.ts': CAN_EDIT,
        ...handlerFiles('who', HANDLERS),
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// THE REVERT: drop the `buildFiledLoads()` line from `composePage`. `me` is first built where the
// page's markup reads `canEdit`, the inline region paints `view` and the deferred child, built a
// turn later, `edit`.
test("a module's value whose build made a call is painted one way across the page — 41.34, 11.67", async () => {
    for (let visit = 0; visit < 3; visit += 1) {
        const html = await (await Bun.fetch(`${base}/owner/`)).text()
        expect(/<p id="inline">(\w+)/.exec(html)?.[1]).toBe('edit')
        expect(/<b id="deferred">(\w+)/.exec(html)?.[1]).toBe('edit')
    }
})
