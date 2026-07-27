// Apply a `BenchSelection` to one runner's label set: serve `--list`, warn about patterns that matched
// nothing, and return the labels to run.
//
// Labels rather than the benches themselves, because a runner's corpus is not always one array — the
// server harness has primitive recipes AND loopback dispatch benches, and both must appear in a single
// `--list` and be judged against a single set of patterns. Each runner then keeps its own items and skips
// what the returned set does not hold.
//
// The unmatched warning is a WARNING, not a failure, on purpose: `bench:delta` forwards one selection to
// BOTH corpora, and a pattern like `memo` legitimately matches the server corpus and nothing in the
// frontend one. A typo is still loud — every pattern that hit nothing is named, and the table it would
// have filled comes out empty. A runner whose verdict would be a false green on an empty selection
// (`gate.ts`, which would otherwise print "all 0 ratios within bounds") fails on it itself.

import type { BenchSelection } from './benchSelection.ts'

// `what` is the PLURAL noun for this runner's corpus ("scenarios", "benches", "bounds").
export function selectBenches(
    labels: string[],
    selection: BenchSelection,
    what: string,
): Set<string> {
    if (selection.list) {
        console.log(`${what} (${labels.length}):\n`)
        for (const label of labels) console.log(`  ${label}`)
        process.exit(0)
    }
    if (selection.patterns.length === 0) return new Set(labels)
    for (const pattern of selection.unmatched(labels)) {
        console.error(
            `\x1b[33m! no match in ${what} for "${pattern}" — run with --list to see them\x1b[0m`,
        )
    }
    const selected = new Set<string>()
    for (const label of labels) if (selection.matches(label)) selected.add(label)
    return selected
}
