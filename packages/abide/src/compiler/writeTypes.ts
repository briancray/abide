// 34.24 — WHAT A `.abide` EXPORTS, AS A PLAIN `.ts` IMPORTING IT IS TYPED. TypeScript reads no
// `.abide`, and a wildcard declaration can name a default alone, so the names a `<script module>` or
// a `<script server>` exports were untyped to every `.ts` outside abide's own checker. Each file's
// projection — its module and server blocks, exactly what that checker answers a `.abide` import
// with (`TypeSession.standIn`) — is written to `.abide/types`, mirroring the tree, where the app's
// `tsconfig` reaches it: `rootDirs` for a relative import, `paths` for `#src/*`.
//
// THE CHECKER IS NOT ASKED, because the API it answers over emits no declarations, and the
// projection is a module TypeScript infers the same types from. `@ts-nocheck` because the blocks are
// read as written — a reactive read by name is the checker's to answer (31.3) and `abide check`'s to
// report, and reported here too it would be one finding twice, at a path nobody wrote.

import { rmSync } from 'node:fs' // bun has no file removal of its own
import { dirname, relative } from 'node:path' // bun exposes no path helpers of its own
import { buildDirectory } from '#server/buildDirectory.ts'
import { namesUnder } from '#server/namesUnder.ts'
import { COMPONENT_MODULE } from './checkedShadow.ts'
import { formatDiagnosis } from './formatDiagnosis.ts'
import { projectShadow } from './projectShadow.ts'
import { type ParsedSource, refusal } from './readSources.ts'
import type { Diagnosis } from './TypeSession.ts'

/**
 * Writes each source's types beside the build, and removes the ones whose `.abide` is gone.
 *
 * A file is written only where its text moved, so an editor watching the directory re-reads what
 * changed rather than everything. WITH `refused`, A SOURCE WHOSE PROJECTION IS REFUSED (34.3, …) is a
 * finding at its first line and keeps the types it last had, as `parseSources` treats one that does
 * not parse; without it the refusal is thrown, naming the file.
 */
export async function writeTypes(
    root: string,
    sources: readonly Pick<ParsedSource, 'path' | 'file'>[],
    /** Whether `sources` is every file, so the types of one not among them are stale. */
    whole = true,
    refused?: Diagnosis[],
): Promise<void> {
    const above = dirname(root)
    // Mirrored below the directory above `root`, as the scaffold's `tsconfig` names it.
    const types = `${buildDirectory(root)}/types`
    const written = new Set<string>()
    const writes: Promise<unknown>[] = []
    for (const source of sources) {
        const path = `${types}/${relative(above, source.path)}.ts`
        written.add(path)
        let projected: string
        try {
            projected = projectShadow(source.file).text
        } catch (thrown) {
            const found = refusal(source.path, thrown)
            if (refused === undefined)
                throw new Error(formatDiagnosis(found, process.cwd()))
            refused.push(found)
            continue
        }
        // The checker's own stand-in for the default: a component taking anything (`COMPONENT_MODULE`).
        const text = `// @ts-nocheck\n${projected}\n${COMPONENT_MODULE}`
        if (WRITTEN.get(path) === text) continue
        writes.push(
            Bun.file(path)
                .text()
                .catch(() => undefined)
                .then((standing) => {
                    WRITTEN.set(path, text)
                    return standing === text ? undefined : Bun.write(path, text)
                }),
        )
    }
    await Promise.all(writes)
    if (!whole) return
    // Only below this root's own mirror: two apps beside one another share the directory above.
    const mirror = `${types}/${relative(above, root)}`
    for (const name of namesUnder(mirror))
        if (!written.has(`${mirror}/${name}`)) {
            rmSync(`${mirror}/${name}`)
            WRITTEN.delete(`${mirror}/${name}`)
        }
}

// What this process last left at each path, so a compile run again (`abide dev`, the language
// server) reads back only the files whose text moved since.
const WRITTEN = new Map<string, string>()
