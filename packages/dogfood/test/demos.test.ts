// Every demo, run as a test.
//
// There is no separate unit-test suite: the demos ARE the tests, so a claim printed on a page is a
// claim `bun test` checks. A case with a `run` asserts headlessly; a case with a `bench` has each
// arm run once, so an arm that stopped compiling or started throwing fails here rather than being
// discovered the next time someone opens the bench page by hand.
//
// A browser-only case — one whose whole point needs a click — is reported as skipped rather than
// silently passing. A SERVER-only one is the mirror image and is not skipped at all: this is the
// runner that has a server, so `server` bodies are asserted here and reported as such on `/tests`.

import { describe, expect, test } from 'bun:test'
import { type Bench, benchRow, runHeadless } from 'harness'
import { count as compiledCount } from '../counter.abide'
import { count } from '../counter.ts'
import { allSuites } from '../demos/index.ts'

// Every suite module, loaded up front. The pages load them one at a time — that is the whole point
// of the split — but a runner genuinely needs all of them.
const SUITES = await allSuites()

for (const suite of SUITES) {
    describe(suite.name, () => {
        for (const spec of suite.cases) {
            if (spec.run === undefined && spec.server === undefined && spec.bench === undefined) {
                test.skip(`${spec.title} — browser only`, () => undefined)
                continue
            }
            test(spec.title, async () => {
                // The lines are READ, not discarded: `runHeadless` hands back what the case logged,
                // and a case that recorded nothing at all is one whose assertions never ran — a
                // `run` that returned early would otherwise pass silently.
                const logged = await runHeadless(spec)
                if (spec.run !== undefined || spec.server !== undefined) {
                    expect(logged.length).toBeGreaterThan(0)
                }
            })
        }
    })
}

/**
 * The one bench arm in the app that MOUNTS, run twice — the app's end of the harness's own gate on
 * the same thing, asserted where an arm is actually written.
 *
 * `prepare` puts a live counter in the scratch holder, and a root nobody disposes stays subscribed to
 * the cell `run` writes: the second run wrote to two components, the third to three, and the row's
 * number grew with every click of `run` on `/bench`. Nothing about the markup is wrong while that
 * happens, and the arm's own smoke run above cannot see it, because it runs each arm once.
 *
 * Verified by taking the dispose loop back out of `sweepContainers` — both columns then read 4 on the
 * second run against 2 on the first, which is exactly the second copy being written to.
 */
describe('a bench arm that mounts, run twice', () => {
    test('the second run counts what the first one did', async () => {
        const suite = SUITES.find((candidate) => candidate.name === 'compiler')
        const spec = suite?.cases.find((candidate) => candidate.title.includes('render identically'))
        if (spec?.bench === undefined) {
            throw new Error('demos: the compiler parity bench is not where this test looks')
        }

        const row = benchRow('compiler', spec, spec.bench as Bench)
        // From the same state both times, because the counter's `class:high` crosses at 2 — an
        // unreset cell would move the count for a reason that has nothing to do with the mounts.
        const runFromZero = async (): Promise<string[]> => {
            count.set(0)
            compiledCount.set(0)
            await row.run()
            return [row.abide.value.peek(), row.handWritten?.value.peek() ?? '']
        }

        const first = await runFromZero()
        const second = await runFromZero()
        expect(second).toEqual(first)
    })
})
