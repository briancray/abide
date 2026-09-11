// A GATE IS VERIFIED BY REVERTING THE FIX AND WATCHING IT FAIL, and this is what
// turns that from a habit three tests were written in violation of into a mechanism.
//
// Entry 5 of 5, and not a lane. `harness/measure`, `harness/engine` and `harness/server` are partitioned
// by DEPENDENCY and `harness/report` depends on nothing; this depends on `bun:test`,
// which is why it is neither one of the three nor part of the leaf — a `bun:test`
// import in the leaf would take the browser injectable with it.
//
// Two fields and an ORDINARY TEST BODY. The draft that carried `run` and `is` could
// not typecheck against its own API — `closures()` hands back a PAIR precisely so
// nobody re-derives it, and a pair does not compare against `is: 0` — and an exact
// integer cannot express "≤1 promise per call", "within 1.05x", or an `underOneFrame`
// tag. Absorbing the assertion into a field also costs the stack: the failure would
// read `expect(received).toBe(expected)` from inside the wrapper rather than from the
// line making the claim, with nowhere to put setup, teardown or an `await`.
//
// `worth` is RUNNABLE, and that is the whole upgrade. As a string it is a note to the
// next reader; as `revert` — a function installing the broken arm — plus `worth` —
// what that arm must report — the revert can be RUN and the gate asserted to fail
// with that number. It also answers the rule about a benchmark case earning its
// place: a case reporting the same number with the mechanism out distinguishes
// nothing, and this says so rather than a reader noticing.
//
// The cost, stated: an engine number is not available inside a case body, so this
// structurally cannot wrap an engine assertion. `RENDERER.md` measurement 1 and
// `SERVER.md` measurement 2 stay a playwright-side convention with no `worth` field.

import { test } from 'bun:test'

export { inAFreshProcess } from './inAFreshProcess.ts'

export type GateSpec = {
    // Installs the broken arm and hands back the undo. A gate whose revert cannot be
    // installed — a module-level guard, a shape decided at construction — keeps its
    // revert in the test's comment with the number it reports; this field is for the
    // ones where the arm is swappable.
    revert: () => unknown
    // What the broken arm reports. Every value has to appear in the failure the
    // reverted run produces, or the revert did not reach the mechanism.
    worth: Record<string, number | string>
}

// The reverts double the gate count and some are not cheap, so they are opt-in.
// Whether that becomes a nightly rather than a flag is not decided here.
const VERIFYING = process.env.HARNESS_VERIFY_GATES === '1'

export function gate(
    name: string,
    spec: GateSpec,
    body: () => void | Promise<void>,
): void {
    if (Object.keys(spec.worth).length === 0)
        throw new Error(
            `gate("${name}") states no \`worth\`. A revert with nothing to report is a revert nobody can tell landed.`,
        )
    test(name, body)
    if (!VERIFYING) return
    test(`${name} — fails with the mechanism out`, async () => {
        const restore = spec.revert()
        let failure: unknown
        try {
            await body()
        } catch (error) {
            failure = error
        } finally {
            if (typeof restore === 'function') (restore as () => void)()
        }
        if (failure === undefined)
            throw new Error(
                `gate("${name}") passed with the mechanism out. A case reporting the same number either way distinguishes nothing, and this gate is worth nothing.`,
            )
        const reported = String(
            (failure as { message?: string }).message ?? failure,
        )
        for (const [counter, value] of Object.entries(spec.worth)) {
            if (reported.includes(String(value))) continue
            throw new Error(
                `gate("${name}") failed with the mechanism out, but not with the number it is worth: \`${counter}\` should report ${value} and the failure was:\n${reported}`,
            )
        }
    })
}
