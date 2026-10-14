import { existsSync, readFileSync } from 'node:fs' // bun exposes no sync existence check or read of its own
import { dirname, posix } from 'node:path' // bun exposes no path helpers of its own
import { resolvedFile } from '#server/abideModules.ts'
import { nearest } from './nearest.ts'

/**
 * Resolves a specifier from a directory as bun does, or `undefined` where it does not resolve.
 *
 * A COMPONENT IMPORT RESOLVES THE WAY THE APP'S OWN IMPORTS DO — its import map, from the file
 * that wrote it. One that does not resolve is left as written, and the bundle names it. THE
 * ANSWER IS A REAL PATH, as every root handed to the compiler is.
 */
export function resolverIn(): (
    specifier: string,
    from: string,
) => string | undefined {
    // ONE ANSWER PER SPECIFIER AND DIRECTORY for as long as the resolver lives: a compile resolves
    // every import once for its dependencies and again for its graph, and hands both one resolver.
    const answered = new Map<string, string | undefined>()
    return (specifier, from) => {
        const key = `${from}\0${specifier}`
        if (answered.has(key)) return answered.get(key)
        const found = resolveFrom(specifier, from)
        answered.set(key, found)
        return found
    }
}

function resolveFrom(specifier: string, from: string): string | undefined {
    try {
        return resolvedFile(specifier, from)
    } catch {
        // 38.65 — BUN KEEPS A DIRECTORY'S LISTING FOR THE LIFE OF THE PROCESS, and looks a `#` specifier up
        // in it with no second look — where a relative one that misses reads the directory again.
        // `abide dev` compiles in one process for its whole session, so a component created since
        // its directory was listed never resolved, and was read as uninvoked. The `imports` map is
        // read here instead, and the file it names looked for on disk.
        return specifier.startsWith('#')
            ? throughImports(specifier, from)
            : undefined
    }
}

/** A `#` specifier resolved through the nearest `package.json`'s `imports`, to a file that exists. */
function throughImports(specifier: string, from: string): string | undefined {
    const manifest = nearest(from, 'package.json')
    if (manifest === undefined) return undefined
    const imports = (
        JSON.parse(readFileSync(manifest, 'utf8')) as {
            imports?: Record<string, unknown>
        }
    ).imports
    if (imports === undefined) return undefined
    const base = dirname(manifest)
    for (const [key, targets] of Object.entries(imports)) {
        const star = key.indexOf('*')
        let matched: string | undefined
        if (star === -1) matched = key === specifier ? '' : undefined
        else if (
            specifier.startsWith(key.slice(0, star)) &&
            specifier.endsWith(key.slice(star + 1)) &&
            specifier.length >= key.length - 1
        )
            matched = specifier.slice(
                star,
                specifier.length - (key.length - star - 1),
            )
        if (matched === undefined) continue
        // A conditions object names no path of its own, and is passed over.
        for (const target of [targets].flat()) {
            if (typeof target !== 'string') continue
            const path = posix.join(base, target.replace('*', matched))
            if (existsSync(path)) return path
        }
    }
    return undefined
}
