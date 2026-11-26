// 15.10 — A REFUSAL MADE AND DROPPED IS A COMPILE ERROR: `refuse` hands back its `Failed` rather than
// throwing it (15.4), so a statement making one and keeping nothing refuses nothing, and the code
// after it runs as though its check had passed.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { checkApp } from '#compiler/checkApp.ts'
import type { Diagnosis } from '#compiler/Diagnostics.ts'

import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const GUARD = `import { refuse } from '@abide/abide'
import { rpc } from '@abide/abide/server'

const notFound = refuse.named('NotFound', { status: 404 })

export const lookup = rpc(async ({ id }: { id: string }) => {
    if (id === '') refuse(400, 'an id is needed')
    if (id === 'gone') notFound()
    if (id === 'later') await Promise.resolve(refuse(410))
    if (id === 'kept') return refuse(409)
    const answer = refuse(418)
    console.log(answer)
    return { id }
})
`

const PAGE = `<script server>
import { refuse } from '@abide/abide'

export const save = async ({ phone }: { phone: string }) => {
    if (phone === '') refuse(400, 'a phone is needed')
    return { phone }
}
</script>

<p>saved</p>`

let app = ''
let found: Diagnosis[] = []

beforeAll(async () => {
    app = appFixture({
        'package.json': JSON.stringify({
            name: 'dropped-refusal-fixture',
            type: 'module',
        }),
        'index.abide': PAGE,
        'lib/guard.server.ts': GUARD,
    })
    found = (await checkApp(app)).filter((diagnosis) =>
        diagnosis.message.includes('15.10'),
    )
}, 60_000)

afterAll(removeTemporaryModules)

// THE REVERT: drop `discardedFailuresIn` from `appLints`; nothing is found, `[]` where four lines are
// due. The near misses — a refusal returned, one kept in a name, `console.log` — are not found.
test('a statement making a refusal and keeping nothing is an error at its line — 15.10', () => {
    expect(
        found.map(({ path, line }) => `${path.slice(app.length + 1)}:${line}`),
    ).toEqual([
        'index.abide:5',
        'lib/guard.server.ts:7',
        'lib/guard.server.ts:8',
        'lib/guard.server.ts:9',
    ])
    expect(found[0]?.category).toBe('error')
})
