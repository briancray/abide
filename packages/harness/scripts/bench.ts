// `bun run bench` — the machinery triple's two countable members for the harness package itself,
// printed: code lines and exported names. The third, branches added to a shared path, stays
// hand-counted. Every other bench is a script of its own under `bench:*`, and the ones with a
// hand-written arm are rows on the docs app's `/bench` page too.
//
// A WORKSPACE SCRIPT AND NOT AN `abide` COMMAND. `abide <cmd>` is governed surface —
// RULEBOOK 38 and REGISTRY's Commands section — so a bench subcommand would owe a
// clause, a registry row and a decisions entry, for a tool no app author runs.

import { countExportedNames } from './countExportedNames.ts'
import { countLines } from './countLines.ts'

const PACKAGE = new URL('../', import.meta.url)

/**
 * The package's public entries, READ OFF ITS `exports` MAP rather than listed — a list beside the
 * map is a second copy, and the one this replaced named five entries while the map had seven.
 *
 * 44.1's five are the three lanes and the two entries that are not lanes, `report` and `gate`.
 * The other two are surface all the same and are counted with them: `measure/vanilla` is the
 * hand-written signal every reactive ratio is against, and `rows` is the contract the docs app's
 * bench and tests pages read.
 */
async function exportedEntries(): Promise<{
    specifiers: string[]
    files: string[]
}> {
    const manifest = (await Bun.file(
        new URL('package.json', PACKAGE),
    ).json()) as {
        name: string
        exports: Record<string, string>
    }
    const specifiers: string[] = []
    const files: string[] = []
    for (const [subpath, file] of Object.entries(manifest.exports)) {
        specifiers.push(`${manifest.name}${subpath.slice(1)}`)
        files.push(file.replace(/^\.\//, ''))
    }
    return { specifiers, files }
}

async function machinery(): Promise<void> {
    const { specifiers, files: entryFiles } = await exportedEntries()
    // EVERYTHING UNDER `src/`, plus each entry file that lives outside it — `rows` is a script,
    // and a surface counted for its names and not its lines is half a budget.
    const files = [
        ...new Bun.Glob('src/**/*.ts').scanSync({
            cwd: PACKAGE.pathname,
            onlyFiles: true,
        }),
    ]
    for (const file of entryFiles) if (!files.includes(file)) files.push(file)
    const lines = await countLines(PACKAGE, files)
    const names = await countExportedNames(specifiers)
    console.log(`harness: ${lines} code lines across ${files.length} files`)
    console.log(
        `harness: ${names.total} exported names across ${specifiers.length} entries`,
    )
    for (const [entry, exported] of Object.entries(names.byEntry))
        console.log(`  ${entry}: ${exported.join(', ') || '—'}`)
}

if (import.meta.main) await machinery()
