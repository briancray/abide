// `abide check [dir…]` — the type-check, as a command.
//
// A shell over `abide/compiler/check`, which is where the work already lives: emit each `.abide` as
// the module and the declaration `tsc` can resolve, run the real checker over the project, and move
// every diagnostic it reports back onto the `.abide` line. Nothing here compiles anything, and that
// is the point — a second checker that agreed with the first until it didn't is the failure this
// whole lane is shaped to avoid.

import { diagnose } from '$compiler/check.ts'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'
import { pathsOnly } from '../COMMANDS.ts'

export async function check(argv: string[]): Promise<number> {
    // Roots, not flags — the same rule `abide build` states, now from the same code. This command used
    // to FILTER them out, so `abide check --lint` checked the working directory and said nothing.
    const roots = pathsOnly('check', argv)
    if (typeof roots === 'number') return roots

    const found = await diagnose(roots)
    // stdout, not stderr: a diagnostic list is this command's OUTPUT — the thing somebody pipes into
    // an editor — and the exit code is what says it failed.
    for (const line of found) console.log(line)
    return found.length > 0 ? CLI_EXIT_CODES.failed : CLI_EXIT_CODES.ok
}
