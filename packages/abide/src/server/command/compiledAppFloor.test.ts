import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { reachableFrom } from '../../test/internal/moduleGraph.ts'

// THE COMPILED BINARY HAS A DEPENDENCY FLOOR: nothing that reads the project's SOURCE may reach it.
//
// `commandSurfaceFloor.test.ts` next door guards the other axis — the HTTP request path must not import
// the command surface. This one guards what the command surface is allowed to drag in, and it walks the
// TRANSITIVE graph rather than each file's own imports, because the edge that mattered was four modules
// deep: `serveCompiled` → `cli/serve.ts` → `loadApp` → `scanAppSources`/`deriveSchemas`. No file in
// `server/command/` named any of them, so a per-file check saw nothing.
//
// SIZE IS THE LESSER PROBLEM (it was 31 KB). These are reachable code paths that CANNOT WORK where a
// binary runs: the filesystem is a read-only `/$bunfs/root`, there is no `src/` to watch or write a
// health companion into, and no source to derive a schema from. Nothing prevented an edit from calling
// one, and the failure would land on a deploy machine rather than here.
//
// The fix was `server/internal/hostApp.ts` — the half of serving with nothing source-reading in it —
// which `serveCompiled` and `commandTarget` now enter directly. `cli/serve.ts` keeps the dev shell.
//
// A STATIC WALK, not a `Bun.build` of the entry. Building the real graph is the more faithful probe and
// was the first draft, but it reads several hundred files and so fails spuriously whenever anything else
// is mid-write in the tree — a floor test that goes red for unrelated reasons gets deleted, not obeyed.
// The trade is that this misses an import expressed as a bare specifier or a dynamic `import()`; the
// modules it guards are all reached by relative path today, and the reachability assertion at the bottom
// fails if that stops being true.

const COMMAND_DIR = import.meta.dir

// Each is a module only the dev/build lane can use, with what a binary would be unable to do with it.
const FORBIDDEN = new Map([
    ['cli/serve.ts', 'the dev shell: filesystem watch, health companion, live-reload snippet'],
    ['server/internal/loadApp.ts', 'project discovery — a binary is static imports in its entry'],
    [
        'server/internal/deriveSchema.ts',
        'live tsgo derivation — a binary has no source to derive from',
    ],
    [
        'cli/writeHealthCompanion.ts',
        'writes into `src/.abide/` — read-only, and there is no `src/`',
    ],
])

describe('the compiled binary carries no source-reading code', () => {
    test('nothing reachable from the binary entry reads the project source', () => {
        const reachable = reachableFrom(join(COMMAND_DIR, 'runCompiledApp.ts'))
        const offenders: string[] = []
        for (const [module, why] of FORBIDDEN) {
            const chain = reachable.get(module)
            if (chain !== undefined) offenders.push(`${chain.join(' → ')}\n    (${why})`)
        }
        expect(offenders).toEqual([])
    })

    // The walk is only meaningful if it reaches anything at all. `internal/router.ts` is the control: a
    // binary hosts the real app through the real router, so it MUST be reachable. If this fails, the
    // resolver above has stopped matching this tree's import spelling and the test is asserting nothing.
    test('the walk reaches the router, so an empty offender list means absence rather than a broken walk', () => {
        const reachable = reachableFrom(join(COMMAND_DIR, 'runCompiledApp.ts'))
        expect(reachable.has('server/internal/router.ts')).toBe(true)
        expect(reachable.size).toBeGreaterThan(50)
    })
})
