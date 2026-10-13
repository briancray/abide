// 38.30 — AN APP WITH NO tsconfig.json IS COMPILED TYPED. What is asserted is what the checker makes
// possible, read off the emitted modules: a read by name lowers (31.1), a server slot reading a
// `Reactive` is guarded so an unlanded value is a hole rather than a failed page (41.4), and the
// client binds it. An untyped build emits every one of those positions as static text, and the page
// still builds — which is why the gate reads the output rather than the exit code.
//
// THE FIXTURE HAS NO PROJECT OF ITS OWN AND NONE ABOVE IT: `temporaryModule` writes inside the repo so
// `@abide/abide` resolves, and the repo root carries `tsconfig.base.json` rather than a `tsconfig.json`.

import { afterAll, expect, test } from 'bun:test'
import { existsSync } from 'node:fs' // bun exposes no sync existence check of its own
import { dirname } from 'node:path' // bun exposes no path helpers of its own
import { spawned } from 'harness/gate'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

afterAll(removeTemporaryModules)

// THE REVERT: open no session where `findTsconfig` finds nothing (`compileApp`); the server page
// emits `count` unlowered and unguarded, and the client module binds nothing.
test('an app with no tsconfig.json is typed against a default project — 38.30', async () => {
    const app = temporaryModule({
        'page.abide': `<script>\nimport { reactive } from '@abide/abide'\n\nlet count = reactive(0)\n</script>\n\n<main><p>{count}</p><button onclick={() => { count = count + 1 }}>+</button></main>`,
        'package.json': JSON.stringify({
            name: 'untyped-fixture',
            type: 'module',
        }),
    })
    for (let at = app; dirname(at) !== at; at = dirname(at))
        expect(existsSync(`${at}/tsconfig.json`)).toBe(false)

    const built = await spawned([
        'bun',
        BIN,
        'build',
        '--root',
        app,
        '--out',
        `${app}/.abide`,
    ])
    expect(built.exitCode).toBe(0)
    const { files } = (await Bun.file(
        `${app}/.abide/compilation.json`,
    ).json()) as { files: Record<string, { server: string; client: string }> }
    const server = files['page.abide']?.server ?? ''
    const client = files['page.abide']?.client ?? ''
    expect(server).toContain('slotValue(() => count())')
    expect(client).toContain('count.set(count() + 1)')
})
