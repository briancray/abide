// 38.30 — AN APP WITH NO tsconfig.json IS TYPED AGAINST ONE OF ABIDE'S, not read untyped. The checker
// is what tells the compiler which names are `Reactive`s (31.3), and with no project to ask every
// template position read as static: the server painted an unlanded read by throwing out of the
// render (41.4), the client never bound a slot at all, and `props` went unseen — an app that built
// clean and did nothing. So the absence of a project gets a project rather than a second compiler.
//
// WRITTEN OUTSIDE THE APP. The build does not write into an author's source tree, so the file lives
// in a temporary directory for as long as the session that reads it, and names the app's files by
// absolute path.

import { mkdtemp, rm } from 'node:fs/promises' // bun exposes no temporary-directory creation or recursive removal of its own
import { tmpdir } from 'node:os' // bun exposes no temporary-directory path of its own
import { dirname, resolve } from 'node:path' // bun exposes no path helpers of its own

import { nearest } from './nearest.ts'

/** What every abide app in the docs and the scaffold is written against. */
export const COMPILER_OPTIONS = {
    strict: true,
    target: 'esnext',
    module: 'preserve',
    moduleResolution: 'bundler',
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
}

/** Writes a temporary tsconfig covering `root`, with the function that removes it. */
export async function writeDefaultProject(
    root: string,
): Promise<{ tsconfig: string; remove: () => Promise<void> }> {
    const directory = await mkdtemp(`${tmpdir()}/abide-project-`)
    const tsconfig = `${directory}/tsconfig.json`
    await Bun.write(
        tsconfig,
        JSON.stringify({
            compilerOptions: {
                ...COMPILER_OPTIONS,
                paths: await aliasPaths(root),
            },
            include: [`${root}/**/*`],
        }),
    )
    return {
        tsconfig,
        remove: () => rm(directory, { recursive: true, force: true }),
    }
}

/**
 * The app's `imports` aliases as `paths`, each target absolute.
 *
 * 34.21 — the checker resolves a text import's declaration beside the file a path names, and takes
 * an `imports` target as the exact file, so `#src/x.abide` imported as text is found through these.
 */
async function aliasPaths(root: string): Promise<Record<string, string[]>> {
    const paths: Record<string, string[]> = {}
    const manifest = nearest(root, 'package.json')
    if (manifest === undefined) return paths
    const imports = (
        (await Bun.file(manifest).json()) as {
            imports?: Record<string, unknown>
        }
    ).imports
    const base = dirname(manifest)
    for (const [key, targets] of Object.entries(imports ?? {})) {
        const resolved: string[] = []
        for (const target of [targets].flat())
            if (typeof target === 'string') resolved.push(resolve(base, target))
        if (resolved.length > 0) paths[key] = resolved
    }
    return paths
}
