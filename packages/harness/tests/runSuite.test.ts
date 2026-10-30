// The tests page's parser, which is the one part of it a test can reach without running the
// suites inside themselves.

import { expect, test } from 'bun:test'

// The JUnit reading is `testRows`' own, and not a name the package exports.
import {
    BUN_REPORT,
    parseJUnit,
    PLAYWRIGHT_REPORT,
} from '../src/runner/runSuite.ts'

const REPORT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" failures="1">
  <testsuite name="a.test.ts" file="a.test.ts" tests="2" failures="1" skipped="0" time="0.0015">
    <testcase name="passes" time="0.000033" />
    <testcase name="fails" time="0.000324">
      <failure type="AssertionError" message="expect(received).toBe(expected)&#10;&#10;Expected: 2&#10;Received: 1&#10;">at a.test.ts:3</failure>
    </testcase>
  </testsuite>
  <testsuite name="b.test.ts" file="b.test.ts" tests="1" failures="0" skipped="1" time="0.02">
    <testcase name="skips &amp; waits" time="0">
      <skipped />
    </testcase>
  </testsuite>
</testsuites>`

test('a failure comes back with the number it reported', () => {
    const suites = parseJUnit(REPORT)
    expect(suites.map((suite) => suite.file)).toEqual([
        'a.test.ts',
        'b.test.ts',
    ])
    expect(suites[0]).toMatchObject({ tests: 2, failures: 1, skipped: 0 })
    expect(suites[1]).toMatchObject({ tests: 1, failures: 0, skipped: 1 })
    const failed = suites[0]?.cases[1]
    expect(failed?.name).toBe('fails')
    // THE NUMBERS ARE THE POINT. A tests page that showed "1 failing" and not what
    // it reported would send the reader back to the terminal, which is the thing it
    // replaces. Reverted to dropping the message, every failure reads the same.
    expect(failed?.failure).toContain('Expected: 2')
    expect(failed?.failure).toContain('Received: 1')
    expect(suites[0]?.cases[0]?.failure).toBeNull()
})

// THE TESTS PAGE LISTS EVERY CASE, so a skipped one has to say so rather than read as a pass.
// Reverted to reading failures alone, the skipped case comes back `skipped: false`.
test('each case says whether it passed, failed or was skipped', () => {
    const [first, second] = parseJUnit(REPORT)
    expect(first?.cases.map((one) => one.skipped)).toEqual([false, false])
    expect(second?.cases[0]?.skipped).toBe(true)
})

test('an escaped name comes back unescaped', () => {
    expect(parseJUnit(REPORT)[1]?.cases[0]?.name).toBe('skips & waits')
})

// A `describe` IS A SUITE INSIDE ITS FILE'S, whose counts already include it. Reverted to one
// suite per `<testsuite>`, this reads as two files, three tests and two failures.
test('a describe block is counted with its file, once', () => {
    const suites = parseJUnit(`<testsuites tests="3" failures="1">
  <testsuite name="c.test.ts" file="c.test.ts" tests="3" failures="1" skipped="0">
    <testcase name="before" time="0" />
    <testsuite name="group" file="c.test.ts" tests="1" failures="1" skipped="0">
      <testcase name="inside" time="0"><failure message="no">no</failure></testcase>
    </testsuite>
    <testcase name="after" time="0" />
  </testsuite>
  <testsuite name="d.test.ts" file="d.test.ts" tests="1" failures="0" skipped="0">
    <testcase name="alone" time="0" />
  </testsuite>
</testsuites>`)
    expect(suites.map((suite) => suite.file)).toEqual([
        'c.test.ts',
        'd.test.ts',
    ])
    expect(suites[0]).toMatchObject({ tests: 3, failures: 1 })
    expect(suites[0]?.cases.map((one) => one.name)).toEqual([
        'before',
        'inside',
        'after',
    ])
    expect(suites[0]?.cases[1]?.failure).toBe('no')
})

// Two runners, two spellings, and the caller supplies which — `bun test` takes a
// flag and playwright takes an environment variable. Reverted to one spelling, the
// browser suite writes no report and the page reads an absent file as zero failures,
// which is the worst answer available.
test('each runner is pointed at its report the way it accepts', () => {
    expect(BUN_REPORT('/tmp/r.xml')).toEqual({
        args: ['--reporter=junit', '--reporter-outfile=/tmp/r.xml'],
        environment: {},
    })
    expect(PLAYWRIGHT_REPORT('/tmp/r.xml')).toEqual({
        args: ['--reporter=junit'],
        environment: { PLAYWRIGHT_JUNIT_OUTPUT_NAME: '/tmp/r.xml' },
    })
})
