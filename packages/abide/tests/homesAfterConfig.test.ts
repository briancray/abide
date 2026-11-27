// A MODULE'S VALUE IS BUILT ONCE THE APP HAS ENTERED. A module-level `reactive` over a handler call
// builds its home at import, and its body runs the handler in-process (1.7). The root layout's
// server block imports that module, so ESM evaluates it before the block's own `onConfig` is filed,
// and the handler read a `config()` with no defaults in it.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const LAYOUT = `<script server>
import { onConfig } from '@abide/abide/server'

onConfig(() => ({ SOME_SETTING: 42 }))
</script>

<script>
import { followedValue } from './lib/followHeld.ts'
</script>

<i>{String(followedValue())}</i><slot/>`

// `unfiled` counts the runs that found no defaults, which a reload after `config.invalidate()` would
// otherwise paper over: the body runs again with them and the answer comes out right.
const HELD = `import { config, memo, rpc } from '@abide/abide/server'

let unfiled = 0

export const held = memo(
    async () => {
        if (config.get().SOME_SETTING === undefined) unfiled += 1
        return 1
    },
    { global: true },
)

export const unfiledRuns = rpc(() => unfiled)
`

const FOLLOW = `import { reactive } from '@abide/abide'
import getHeld from '#src/getHeld.server.ts'

const followed = reactive(() => getHeld())
export const followedValue = () => (followed.ready() ? followed.get() : undefined)
`

let stop = (): void => {}
let base = ''

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'layout.abide': LAYOUT,
        'index.abide': '<p>home</p>',
        'lib/held.server.ts': HELD,
        'lib/followHeld.ts': FOLLOW,
        'getHeld.server.ts': `import { rpc } from '@abide/abide/server'
import { held } from './lib/held.server.ts'

export default rpc(held)
`,
        'unfiledRuns.server.ts': `import { unfiledRuns } from './lib/held.server.ts'

export default unfiledRuns
`,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// THE REVERT: drop `deferHomes()` from `enterApp`. `followed`'s home is built while the layout's
// server block is imported, and `held` runs once before `onConfig` is filed — 1 run, against 0.
test("a module's value is built after every onConfig is filed — 11.82", async () => {
    expect(await (await Bun.fetch(`${base}/getHeld`)).json()).toBe(1)
    expect(await (await Bun.fetch(`${base}/unfiledRuns`)).json()).toBe(0)
})
