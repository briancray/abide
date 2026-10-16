import { expect, test } from 'bun:test'
import { spawned } from '@abide/harness/gate'

const APP = new URL('..', import.meta.url).pathname
const BIN = new URL('../../abide/bin/abide.ts', import.meta.url).pathname

// THE DOCS APP IS THE FRAMEWORK'S SHOWCASE, so every card a reader copies has to compile as written:
// `abide check` over the whole app, exactly as an author runs it, and not one error. Warnings are
// left alone — `Counts.abide` is a card ABOUT one (14.14), and it is the teaching.
//
// THE REVERT: plant `const planted: number = 'one'` in any card's `<script>`. The run then reports
// `abide check: 1 error` and the line naming it, which is what the failure prints.
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
