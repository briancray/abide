// 44.25's `__ABIDE_WORK__` RECORD, and the dev flag that installs it.
//
// `harness/measure` may have no abide in its import graph at all (44.1), and a
// prototype patch cannot see an effect re-run: there is no DOM member to wrap when a
// reader wakes, and `propagated`'s descents happen inside a module-local loop with no
// object to spy on. So the framework publishes a fixed-shape record on the global,
// the harness READS and zeroes it, and reading a global is not an import edge — which
// is what keeps `lanes.test.ts` green. See docs/DECISIONS.md D113.
//
// THE FIELDS ARE ALWAYS COUNTED AND ONLY THE PUBLICATION IS FLAGGED. `WORK.wakes++`
// on a monomorphic module-level record is an increment on a field the whole process
// shares; a flag READ at every wake is a branch in the loop every write walks, which
// is the thing this package spends its budget policing. The record is the same object
// either way, so the harness's zeroing pass writes onto exactly what `wake` bumps.
//
// The flag is `ABIDE_WORK`, and naming it is this package's call rather than the
// harness's — 44.25 pins the ADDRESS and the shape and says nothing about what turns
// publication on. The framework had no flags before this one, so it sets the pattern:
// an `ABIDE_`-prefixed name, read off `process.env` on a server and off `globalThis`
// in a browser, where the measure injectable can set it before abide is imported.

// Every field `PUBLISHED_WORK_FIELDS` names, and no others. 44.24 makes a field the
// harness reads and this record does not declare a THROW rather than a silent zero,
// so the two lists are one list agreed by two documents.
export const WORK = {
    // Effect re-runs. The row CLAUDE.md's "assert WAKE-UPS, not values" is about.
    wakes: 0,
    // Compiled reactive slots that ran. `RENDERER.md`'s bindings per row.
    bindingRuns: 0,
    // Nodes visited inside `propagated`, per probe read.
    descents: 0,
    // `Link`s constructed. The "0 allocations on a stable dependency" budget row.
    links: 0,
    // Probe subscriptions a memo holds of its own — 11.22 buys zero of these.
    subscriptions: 0,
    // Entries a keyed `memo` allocated. 11.62 buys zero on a probe.
    entries: 0,
}

const PUBLISHED_WORK_KEY = '__ABIDE_WORK__'

export function publishWork(): void {
    ;(globalThis as Record<string, unknown>)[PUBLISHED_WORK_KEY] = WORK
}

const flagged =
    (globalThis as { ABIDE_WORK?: unknown }).ABIDE_WORK !== undefined ||
    (typeof process !== 'undefined' && process.env?.ABIDE_WORK !== undefined)

if (flagged) publishWork()
