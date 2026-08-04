// A STATIC IMPORT WALK over the source tree — the shared machinery behind every dependency FLOOR test
// (`server/command/compiledAppFloor.test.ts` and, below it, `cli/dispatcherFloor.test.ts`).
//
// It is deliberately a static walk and NOT a `Bun.build` of the entry. The build probe is more faithful
// and was the first draft, but it reads several hundred files and went red whenever anything else in
// the tree was mid-write — and a floor test that fails for unrelated reasons gets deleted, not obeyed.
//
// The corollary a caller must respect: a floor that rests on TREE-SHAKING is not a floor. This walk sees
// an import edge whether or not an optimiser would drop it, which is the point — a test cannot assert a
// property only the optimiser holds. Every floor built on this should also assert a CONTROL (something
// it expects to find), so an empty offender list means absence rather than a broken walk.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

// The `src/` root every returned path is relative to.
export const SRC_ROOT = resolve(import.meta.dir, '../..')

// Resolve a relative specifier against the importing file, as the runtime would.
export function resolveImport(fromFile: string, specifier: string): string | undefined {
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
// value import mistaken for a type one — would make this test blind, so every floor built on this
// asserts a reachability control.
//
// COMMENT LINES ARE STRIPPED FIRST, and that is not defensive tidying — this codebase's headers quote
// import statements when they explain a dependency that was REMOVED. `cli/build.ts` says it exists
// because the compile lane "had to `import { build } from './main.ts'`", and without this strip the
// walk read that sentence as the very edge the module was written to delete, reporting
// `build.ts → main.ts → serve.ts/compile.ts/run.ts`. A floor test that invents edges out of prose is
// worse than none: the first thing it does is send you looking for an import that is not there.
export function importsOf(file: string): string[] {
    // Line comments only. A block comment cannot open and close around an import statement without the
    // line-start test catching its continuation lines, and stripping `/*…*/` by regex would eat the
    // `*` inside a specifier's path if one ever appeared.
    const source = readFileSync(file, 'utf8')
        .split('\n')
        .map((line) => {
            const trimmed = line.trimStart()
            return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
                ? ''
                : line
        })
        .join('\n')
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
export function reachableFrom(entry: string): Map<string, string[]> {
    const seen = new Map<string, string[]>()
    const queue: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [] }]
    while (queue.length > 0) {
        const next = queue.shift()
        if (next === undefined) break
        const key = relative(SRC_ROOT, next.file)
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
