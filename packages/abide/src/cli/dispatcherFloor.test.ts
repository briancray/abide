// THE DISPATCHER IS NOT A LIBRARY. `main.ts` parses argv and picks a command; the work each command
// does belongs in a module beside it.
//
// `build.ts` states the rule for itself — "A MODULE rather than a function body inside `main.ts`,
// because `main.ts` is the CLI DISPATCHER and this is a step of the build pipeline… so the compile lane
// depended on the argv parser." That extraction stopped at `build`, and the consequence it predicts had
// already landed: `bundle()`, `scaffold()` and `forwardLsp()` stayed in the dispatcher, so
// `bundle/bundle.test.ts` imported a launcher writer from `../cli/main.ts` and pulled in `serve`,
// `compile`, `run`, `installShutdownHandlers` and the starter-template constants to test it.
//
// The rule is now asserted rather than restated. Same static walk the compiled-binary floor uses, same
// caveat: it sees an import edge whether or not an optimiser would drop one, because a floor that rests
// on tree-shaking is not a floor.

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { reachableFrom } from '../test/internal/moduleGraph.ts'

const CLI_DIR = import.meta.dir

// A command's own module must not reach back into the dispatcher, nor sideways into a SIBLING command —
// the two edges that make `main.ts` a hub. `build.ts` is exempt as a target: it is a genuine pipeline
// STEP that `bundle` and `compile` both consume, which is what made extracting it right in the first
// place.
const EXTRACTED = ['bundle.ts', 'scaffold.ts', 'forwardLsp.ts'] as const
const SIBLING_COMMANDS = ['serve.ts', 'compile.ts', 'run.ts', 'check.ts', 'dev.ts', 'start.ts']

describe('an extracted command pulls in neither the dispatcher nor its siblings', () => {
    for (const entry of EXTRACTED) {
        test(`${entry} reaches no dispatcher and no sibling command`, () => {
            const reachable = reachableFrom(join(CLI_DIR, entry))
            const offenders: string[] = []
            for (const [module, chain] of reachable) {
                const file = module.slice(module.lastIndexOf('/') + 1)
                if (file === 'main.ts' || SIBLING_COMMANDS.includes(file)) {
                    offenders.push(`${module} — via ${chain.join(' → ')}`)
                }
            }
            expect(offenders).toEqual([])
        })
    }

    test('the walk actually spans the graph (the control)', () => {
        // Without this, an empty offender list above could mean a broken walk rather than a clean floor.
        // `bundle` genuinely depends on `build` — that edge is the one it is SUPPOSED to have.
        const reachable = reachableFrom(join(CLI_DIR, 'bundle.ts'))
        expect([...reachable.keys()]).toContain('cli/build.ts')
        expect([...reachable.keys()]).toContain('cli/bundleLauncher.ts')
    })
})
