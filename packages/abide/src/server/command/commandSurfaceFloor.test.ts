// THE COMMAND SURFACE IS A LEAF. Nothing on the HTTP request path may import it.
//
// This is the property that let 30 files move out of `server/internal/` and into `server/command/` as a
// provably inert change, and it is the one worth keeping: the router, the rpc pipeline, the socket mux and
// the page renderer must never depend on what a compiled binary does when you run it. The dependency goes
// one way — `command/` reaches into `internal/` for the router it hosts and the app it loads, and
// `internal/` reaches back for nothing.
//
// It is asserted by reading the source rather than by a lint rule because the failure it guards is a
// PLAUSIBLE edit, not a typo: wiring a reserved command into a route (an `/__abide/logs`-style endpoint
// that reuses `logsCommand`'s formatting, say) reads as reuse and would quietly put the terminal line
// reader, the REPL and the credential file on the HTTP path — where `interactiveCli`'s stdin handling and
// `readCliTarget`'s `0600` file have no business being.
//
// The converse direction is deliberately NOT asserted. `command/` importing `internal/router.ts` is
// correct: `serve` hosts the app, and there is no second copy of the router to host it with.

import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const HERE = import.meta.dir
const INTERNAL = join(HERE, '..', 'internal')

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).filter((name) => name.endsWith('.ts'))
}

describe('server/internal never imports server/command', () => {
    test('no module on the HTTP request path reaches the command surface', () => {
        const offenders: string[] = []
        for (const name of sourceFiles(INTERNAL)) {
            const source = readFileSync(join(INTERNAL, name), 'utf8')
            // Both spellings, so a `import type` and a bare `from` are caught alike. A test in
            // `internal/` is exempt for the same reason ADR 0026's layering rule exempts tests: the rule
            // protects the production graph, and a test is not in it.
            if (name.endsWith('.test.ts')) continue
            for (const match of source.matchAll(/from '\.\.\/command\/([A-Za-z0-9_]+)\.ts'/g)) {
                offenders.push(`${name} → command/${match[1]}`)
            }
        }
        expect(offenders).toEqual([])
    })

    // The guard is only meaningful if it can see an import at all — a regex that matched nothing would
    // pass forever. So assert the shape it looks for is the shape the tree actually uses, by finding it in
    // the direction that IS allowed.
    test('the guard matches the import spelling this tree uses (proven on the allowed direction)', () => {
        const reaching: string[] = []
        for (const name of sourceFiles(HERE)) {
            if (name.endsWith('.test.ts')) continue
            const source = readFileSync(join(HERE, name), 'utf8')
            for (const match of source.matchAll(/from '\.\.\/internal\/([A-Za-z0-9_]+)\.ts'/g)) {
                reaching.push(`${name} → internal/${match[1]}`)
            }
        }
        // `serveCompiled` hosts the app through the real router; `commandTarget`/`embeddedClientBuild` name
        // the `ClientBuild` shape. If this list is ever empty the regex above has stopped matching and the
        // first test is asserting nothing.
        expect(reaching.length).toBeGreaterThan(0)
    })
})
