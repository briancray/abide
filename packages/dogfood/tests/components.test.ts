// THE DOCS APP'S OWN COMPONENTS PASS THEIR TESTS, run where they can be: from the app's directory,
// under its `bunfig.toml`, whose preload compiles a `.abide` a test imports (38.109). The root's
// `bun test` loads no such preload, so a component's test sits beside it in `src` and runs here.

import { expect, test } from 'bun:test'

import { spawned } from '@abide/harness/gate'

import { DOGFOOD } from './docsPages.ts'

test('the docs app’s components pass their own tests', async () => {
    const tested = await spawned(['bun', 'test', './src'], { cwd: DOGFOOD })
    expect(tested.exitCode, tested.stdout + tested.stderr).toBe(0)
}, 60_000)
