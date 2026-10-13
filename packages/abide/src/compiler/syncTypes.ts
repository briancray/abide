// 34.24 — THE TYPES A PLAIN `.ts` READS A `.abide` BY, written with no checker and no build: the
// files parsed and projected, and nothing else. What `abide sync` runs — and the scaffold's `prepare`
// with it, so a project is typed as soon as it is installed — and what the language server runs as
// a file is edited.

import { sourcesUnder } from './compileApp.ts'
import { parseSources } from './readSources.ts'
import type { Diagnosis } from './TypeSession.ts'
import { writeTypes } from './writeTypes.ts'

/**
 * Writes the types of every `.abide` under `appRoot`, `held` standing in for the text on disk of
 * the files an editor has open; answers how many files it typed and what it refused. A file that
 * does not parse, or whose projection is refused, is left as it last was and the rest are typed.
 */
export async function syncTypes(
    appRoot: string,
    held: ReadonlyMap<string, string> = new Map(),
): Promise<{ typed: number; refused: Diagnosis[] }> {
    const { root, sources } = await sourcesUnder(appRoot)
    const read: { path: string; text: string }[] = []
    for (const source of sources)
        read.push({
            path: source.path,
            text: held.get(source.path) ?? source.text,
        })
    const refused: Diagnosis[] = []
    const parsed = parseSources(read, refused)
    const unparsed = refused.length
    await writeTypes(root, parsed, true, refused)
    return { typed: parsed.length - (refused.length - unparsed), refused }
}
