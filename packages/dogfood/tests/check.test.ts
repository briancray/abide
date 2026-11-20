import { expect, test } from 'bun:test'

import { spawned } from '@abide/harness/gate'

import { BIN } from '../../abide/tests/builtApp.ts'
import { DOGFOOD as APP } from './docsPages.ts'

// THE DOCS APP IS THE FRAMEWORK'S SHOWCASE, so every page a reader reads has to compile as written:
// `abide check` over the whole app, exactly as an author runs it, and not one error.
//
// THE REVERT: plant `const planted: number = 'one'` at the top of `src/index.abide`'s `<script>`.
// The failure then names two lines, `src/index.abide:2:7 - error TS2322` and `TS6133`.
test('abide check finds no error anywhere in the docs app', async () => {
    const { exitCode, stdout } = await spawned(
        [process.execPath, BIN, 'check'],
        { cwd: APP, deadline: 50_000 },
    )
    const errors: string[] = []
    for (const line of stdout.split('\n'))
        if (line.includes(' - error')) errors.push(line)
    expect(errors).toEqual([])
    expect(exitCode).toBe(0)
}, 60_000)
