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
import { runHeadless } from 'harness'
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
