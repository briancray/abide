// `bun run bench` — the machinery triple, printed. Every other bench is a script of its own under
// `bench:*`, each against the hand-written arm its claim is a ratio of.
//
// A WORKSPACE SCRIPT AND NOT AN `abide` COMMAND. `abide <cmd>` is governed surface —
// RULEBOOK 38 and REGISTRY's Commands section — so a bench subcommand would owe a
// clause, a registry row and a decisions entry, for a tool no app author runs.

import { machineryCounts } from './machineryCounts.ts'

// The machinery triple, as the bench reports it. `machineryCounts` is the count itself, shared with
// the status dashboard so the two cannot print different numbers.
async function machinery(): Promise<void> {
    const { lines, files, names } = await machineryCounts()
    console.log(`harness: ${lines} code lines across ${files} files`)
    console.log(`harness: ${names.total} exported names`)
    for (const [entry, exported] of Object.entries(names.byEntry))
        console.log(`  ${entry}: ${exported.join(', ') || '—'}`)
}

if (import.meta.main) await machinery()
