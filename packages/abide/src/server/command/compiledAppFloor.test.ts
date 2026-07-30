import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

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
const SRC = resolve(COMMAND_DIR, '../..')

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

// Resolve a relative specifier against the importing file, as the runtime would.
function resolveImport(fromFile: string, specifier: string): string | undefined {
    if (!specifier.startsWith('.')) return undefined
    const target = resolve(dirname(fromFile), specifier)
    return existsSync(target) ? target : undefined
}

// Every relative VALUE import in a module. Type-only edges are skipped because they are ERASED — they
// pull no code into the binary, and the measurement that motivated this test (six dev-lane symbols, gone
// from the emitted graph) is about what ships. `commandTarget` naming `LoadedApp` is the shape of a
// config it is handed, not a call into the loader.
//
// The elision rule this approximates is the compiler's: a statement is erased when it is `import type`,
// or when every named specifier is itself marked `type`. Getting that wrong in the SAFE direction — a
// value import mistaken for a type one — would make this test blind, so the reachability control at the
// bottom asserts the walk still spans the graph.
function importsOf(file: string): string[] {
    const source = readFileSync(file, 'utf8')
    const found: string[] = []
    for (const match of source.matchAll(/import\s+(type\s+)?([^']*?)from\s+'(\.[^']+)'/gs)) {
        const specifier = match[3]
        if (specifier === undefined) continue
        if (match[1] !== undefined) continue // `import type { … } from`
        const clause = match[2] ?? ''
        const named = clause.match(/\{([^}]*)\}/)?.[1]
        if (named !== undefined && clause.replace(named, '').trim() === '{}') {
            // A braces-only clause: erased when every specifier carries its own `type`.
            const specifiers = named
                .split(',')
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0)
            if (specifiers.length > 0 && specifiers.every((entry) => entry.startsWith('type ')))
                continue
        }
        found.push(specifier)
    }
    return found
}

// Walk out from `entry`, returning every reachable module as a path relative to `src/`, plus the shortest
// path to each so a failure names the chain rather than only its endpoint.
function reachableFrom(entry: string): Map<string, string[]> {
    const seen = new Map<string, string[]>()
    const queue: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [] }]
    while (queue.length > 0) {
        const next = queue.shift()
        if (next === undefined) break
        const key = relative(SRC, next.file)
        if (seen.has(key)) continue
        const chain = [...next.chain, key]
        seen.set(key, chain)
        // A test never ships; walking one would drag its fixtures into the graph.
        if (key.endsWith('.test.ts')) continue
        for (const specifier of importsOf(next.file)) {
            const target = resolveImport(next.file, specifier)
            if (target !== undefined) queue.push({ file: target, chain })
        }
    }
    return seen
}

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
