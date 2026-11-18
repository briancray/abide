// 34.25 — A PACKAGE'S COMPONENT IS HELD TO ITS PROPS where the app imports it, through the entry the
// package's `exports` lists it under and through the workspace link bun installs it as.
//
// IN A PROCESS OF ITS OWN because the miss shows on the first check a process makes (`checkLinked`).
//
// THE REVERTS: suffix a package specifier in `pointAtCheckedModules` and the import names an entry
// the map does not list — TS2307 in place of TS2322. Leave a dependency out of the sources
// `compiledSources` diagnoses, or key `ShadowHost`'s stand-ins by the name asked rather than the
// real one, and `title` takes anything: the check passes.

import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, symlinkSync } from 'node:fs' // bun has no sync mkdir or symlink of its own

import { spawned } from '@abide/harness/gate'

import { appFixture, BIN } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

test("a linked package's component is held to its props through its exports entry", async () => {
    const kit = temporaryModule({
        'package.json': JSON.stringify({
            name: 'kit',
            type: 'module',
            exports: { './Card.abide': './src/Card.abide' },
        }),
        'src/Card.abide': `<script>
import { props } from '@abide/abide'
const { title } = props<{ title: string }>()
</script>
<p>{title}</p>`,
    })
    const app = appFixture({
        'index.abide': `<script>
import Card from 'kit/Card.abide'
</script>
<Card title={1}/>`,
    })
    mkdirSync(`${app}/node_modules`)
    symlinkSync(kit, `${app}/node_modules/kit`)
    const checked = await spawned(['bun', BIN, 'check', '--root', app], {
        cwd: app,
    })
    expect(checked.stdout).toContain('index.abide:4:')
    expect(checked.stdout).toContain('TS2322')
    expect(checked.stdout).not.toContain('TS2307')
    expect(checked.exitCode).toBe(1)
}, 60_000)
