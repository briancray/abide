// 27.13 — `Config` IS TYPED BY AN `onConfig` IN A HANDLER FILE, the one module that is no `.abide`
// and may call a hook (37.13): each is typed beside the file (`moduleConfigShadow`), and a page that
// only reads `config()` is held to what they default.
//
// THE REVERT: drop the handler-file loop from `TypeSession.diagnose`; nothing declares the
// two keys, every `config()` member reads the index's `unknown`, and the findings are 5 where 2 are
// due — the two assignments to a `string`, and three `unknown` assigned to typed bindings beside them.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { realpathSync } from 'node:fs' // bun exposes no sync realpath of its own
import { relative } from 'node:path' // bun exposes no path helpers of its own

import { checkApp } from '#compiler/checkApp.ts'
import type { Diagnosis } from '#compiler/TypeSession.ts'

import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

let found: Diagnosis[] = []
let app = ''

beforeAll(async () => {
    app = appFixture({
        'media/getGrid.handler.ts': `import { config, GET, onConfig } from '@abide/abide/server'

onConfig(() => ({ RETRIES: 3 }))

export default GET(() => {
    const retries: number = config().RETRIES
    const wrong: string = config().RETRIES
    return { retries, wrong }
})
`,
        'media/getLabel.handler.ts': `import { GET, onConfig } from '@abide/abide/server'

onConfig(() => ({ LABEL: 'grid' }))

export default GET(() => 'grid')
`,
        'reads/index.abide': `<script server>
import { config } from '@abide/abide/server'

const label: string = config().LABEL
const retries: number = config().RETRIES
const wrong: number = config().LABEL
</script>

<p>reads</p>`,
    })
    found = (await checkApp(app)).filter(
        (diagnosis) => diagnosis.category === 'error',
    )
}, 60_000)

test('two handler files type Config for every file that reads it — 27.13', () => {
    const at: string[] = []
    for (const diagnosis of found)
        at.push(
            `${relative(realpathSync(app), diagnosis.path)}:${diagnosis.line}:${diagnosis.code}`,
        )
    expect(at.sort()).toEqual([
        'media/getGrid.handler.ts:7:2322',
        'reads/index.abide:6:2322',
    ])
})
