// THE CRM PASSES ITS OWN TESTS AND ITS OWN CHECK, run as a reader who downloaded it runs them: from
// the app's directory, under its own `bunfig.toml`. A card's Tests view shows what these report, so a
// red one here is a card claiming a test the app fails (40.38).

import { expect, test } from 'bun:test'

import { spawned } from '@abide/harness/gate'

import { DOGFOOD } from './docsPages.ts'

const CRM = `${DOGFOOD}examples/crm`

// A process each: the suite runs every card's component, past `spawned`'s 60 s on a CI runner, and
// still inside this test's own 120 s, so a hang fails naming the command.
test.concurrent(
    'the CRM passes its own tests',
    async () => {
        const tested = await spawned(['bun', 'test'], {
            cwd: CRM,
            deadline: 110_000,
        })
        expect(tested.exitCode, tested.stderr).toBe(0)
    },
    120_000,
)

test.concurrent(
    'the CRM passes its own check',
    async () => {
        const checked = await spawned(['bun', 'run', 'check'], { cwd: CRM })
        expect(checked.exitCode, checked.stdout + checked.stderr).toBe(0)
    },
    120_000,
)
