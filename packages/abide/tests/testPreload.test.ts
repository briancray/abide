// 38.109 — `@abide/abide/test`, preloaded: an app's own test imports its `.abide` files and its
// handler files at the top of the file, as any module, with no `createApp` run first. Spawned as an
// author runs it — `bun test` in the app's directory, under the `bunfig.toml` the scaffold writes —
// because a preload is read when a run starts, and this run is already under happy-dom's.

import { afterAll, expect, test } from 'bun:test'
import { spawned } from 'harness/gate'
import { TEST_PRELOAD } from '#compiler/scaffold.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

// A component and a handler file, and a test beside them under the subject's `tests` fence.
function app(bunfig: string | undefined): string {
    return temporaryModule({
        'package.json': JSON.stringify({
            name: 'preload-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        ...(bunfig === undefined ? {} : { 'bunfig.toml': bunfig }),
        'src/index.abide': '<main>home</main>',
        'src/media/lib/Badge.abide': `<script>
import { props } from '@abide/abide'

const { label } = props<{ label: string }>()
</script>

<span id="badge">{label}</span>`,
        'src/media/getThing.ts': `import { GET } from '@abide/abide/server'

export default GET(() => 'thing')
`,
        'src/media/tests/badge.test.ts': `import { expect, test } from 'bun:test'
import { render } from '@abide/abide/server'
import Badge from '../lib/Badge.abide'
import getThing from '../getThing.ts'

test('the component and the handler are the modules the app compiles', async () => {
    const html = new TextDecoder().decode(await render(Badge({ label: 'live' })))
    expect(html).toContain('<span id="badge">live</span>')
    expect(getThing.method).toBe('GET')
})
`,
    })
}

// THE REVERT, which is the fixture without its preload: bun's own file loader answers the import with
// the file's path, and the same run fails on `Badge is not a function` — exit 1, `0 pass`.
test('a test under the preload imports a .abide and a handler file of the app — 38.109', async () => {
    // Both runs at once: each is its own app and its own process.
    const [ran, unloaded] = await Promise.all([
        spawned(['bun', 'test', './src/media/tests/badge.test.ts'], {
            cwd: app(TEST_PRELOAD),
        }),
        spawned(['bun', 'test', './src/media/tests/badge.test.ts'], {
            cwd: app(undefined),
        }),
    ])
    expect(`${ran.exitCode} ${ran.stderr.includes('1 pass')}`, ran.stderr).toBe(
        '0 true',
    )
    expect(unloaded.exitCode).not.toBe(0)
    expect(unloaded.stderr).toContain('Badge is not a function')
}, 90_000)
