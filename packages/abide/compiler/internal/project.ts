// Which `tsconfig.json` covers a directory — the one question both checker lanes have to answer the
// same way.
//
// `check.ts` runs `tsc` over a program and `shapes.ts` hands the same program to the native checker,
// and neither can use "the config beside the working directory": that was one config covering every
// package, and it is now a base with no files in it at all. A run from the repo root then opens an
// EMPTY program, which does not fail — it reports no diagnostics and derives no shapes, which is what
// clean looks like.
//
// A leaf, so `shapes.ts` can keep taking what it needs from the leaves rather than through the
// compiler's barrel: an edge onto `index.ts` would hand a CLI entry the whole emitter for this walk.

// `node:path` stands in for nothing: Bun ships no path api, and the builtin IS the supported one.
import { dirname, resolve } from 'node:path'

/**
 * The nearest `tsconfig.json` at or above `from`, or `null` for a tree with none. `from` may be a
 * file — the first probe simply misses, which is a cheaper rule than two entry points.
 *
 * NOT the same climb as the mirror's, which stops at a `package.json`. The mirror hangs off the
 * package because that is where bare specifiers resolve from; the PROGRAM is whatever config covers
 * the files, and those are not always one directory — the type fixtures that must FAIL are a config
 * of their own, inside a package whose config excludes them.
 */
export async function configAbove(from: string): Promise<string | null> {
    let at = resolve(from)
    for (;;) {
        const path = `${at}/tsconfig.json`
        if (await Bun.file(path).exists()) return path
        const above = dirname(at)
        if (above === at) return null
        at = above
    }
}
