// 41.34, 41.35 AND 11.73 — WHAT A RENDER BUILDS UP FRONT IS A MODULE'S DECLARATION, AND BUILDING ONE THAT
// READS ITSELF ENDS. A value filed while its load was in flight is built in every render's setup; one
// whose first run there read the value itself reached a request instance that was not yet filed, built
// another, and recursed until the stack ran out — inside the render, which still answered 200. And a
// value a component's setup built outside every request, as a browser half mounted in the same test
// process as the server, was filed as a declaration and built again in every render after it.
//
// THE APP IS IN THIS PROCESS'S OWN SCRIPT, which builds the values beside `createApp` the way a test
// file of an app does: `createApp` boots the app at the working directory.

import { afterAll, expect, test } from 'bun:test'

import { lastLinePrinted } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

/** `body` run after `createApp`, in a script whose last line prints what `body` answers. */
function hosted(body: string): Promise<unknown> {
    const app = temporaryModule({
        'package.json': JSON.stringify({
            name: 'fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'src/index.abide': '<main><p>page</p></main>',
        'host.ts': `import { reactive } from '@abide/abide'
import { collectWatches } from '@abide/abide/runtime'
import { createApp } from '@abide/abide/server'

const app = await createApp()
const render = async () => (await app.fetch(new Request('http://app.invalid/'))).text()
${body}
await app.stop()
`,
    })
    return lastLinePrinted([process.execPath, `${app}/host.ts`], {
        cwd: app,
        env: { ...process.env, NODE_ENV: 'production' },
    })
}

// THE REVERT: drop the `filed.building === building` refusal from `built` in `scoped.ts`. Every read
// of `self` in its first run builds one more request instance until the stack overflows —
// `{ runs: 3798, failed: 'RangeError' }`, the count moving with the stack's depth.
test('a filed value whose first run in a render reads itself fails that run — 11.73, 41.34', async () => {
    expect(
        await hosted(`let stop = false
let runs = 0
let failed = ''
const self = reactive(async () => {
    runs += 1
    if (stop) {
        try {
            return self.peek()
        } catch (thrown) {
            failed ||= thrown.name
            throw thrown
        }
    }
    await Bun.sleep(50)
    return 1
})
void self.peek()
stop = true
await render()
console.log(JSON.stringify({ runs, failed }))`),
    ).toEqual({ runs: 2, failed: 'ReferenceError' })
}, 60_000)

// THE REVERT: drop `&& !settingUp()` from the provider's `filed` in `requestScope.ts`. The value the
// setup built is filed, and the render builds a request instance of it: 2 runs.
test("a value a setup builds outside every request is no module's declaration — 41.35", async () => {
    expect(
        await hosted(`let runs = 0
const outer = collectWatches([])
let copy
try {
    copy = reactive(async () => {
        runs += 1
        await Bun.sleep(50)
        return 1
    })
} finally {
    collectWatches(outer)
}
void copy.peek()
await render()
console.log(JSON.stringify(runs))`),
    ).toBe(1)
}, 60_000)

// THE REVERT: hold `LOADING`'s values strongly in `filedLoads.ts`. Every value the callback built is
// still filed after the collection, and the render builds a request instance of each: 200 runs where
// 100 are due.
test('a value built outside every request that nothing reaches is not built by a render — 41.35', async () => {
    const runs = (await hosted(`let runs = 0
const built = () => {
    for (let one = 0; one < 100; one += 1)
        void reactive(async () => {
            runs += 1
            await Bun.sleep(50)
            return 1
        }).peek()
}
built()
await Bun.sleep(100)
Bun.gc(true)
await render()
console.log(JSON.stringify(runs))`)) as number
    expect(runs).toBeLessThan(150)
}, 60_000)
