// Does the generated type mirror forget a source that is gone?
//
// `abide check` emits three files per `.abide` into `.abide/types/`, and `allowArbitraryExtensions`
// resolves every `import './x.abide'` against that tree. Nothing used to remove an entry whose source
// had been deleted or moved, so the declaration went on answering the import forever — and the whole
// gate then passed on a program that does not exist.
//
// It passes only on the machine that has the stale file. The mirror is gitignored, so a fresh clone
// regenerates it from the sources that remain and fails on the same import. That is the shape of the
// failure this asserts against: green here, red on a machine that has never run it, which is the one
// direction a checker cannot report on itself.
//
// A `bun test` claim rather than a demo case, for the reason the rest of `test/` exists: the artifact
// is files on a disk, and a browser row cannot see one.

import { expect, test } from 'bun:test'
import { emitAll, TYPES_DIR } from 'abide/compiler/check'

const ROOT = '/tmp/abide-mirror-gate'
const SOURCE = `${ROOT}/widget.abide`
const MIRROR = `${ROOT}/${TYPES_DIR}`

/** The three paths one source owns, which are the three a prune has to take with it. */
const EMITTED = [`${MIRROR}/widget.abide.ts`, `${MIRROR}/widget.abide.ts.map`, `${MIRROR}/widget.d.abide.ts`]

const exists = async (path: string): Promise<boolean> => Bun.file(path).exists()

async function present(): Promise<boolean[]> {
    return Promise.all(EMITTED.map(exists))
}

test('a mirror entry does not outlive the .abide it was emitted from', async () => {
    await Bun.$`rm -rf ${ROOT}`.quiet()
    // A `package.json` because the mirror hangs off the nearest package BOUNDARY — that is where
    // `rootDirs` and bare-specifier resolution start, so it is where the sweep has to look.
    await Bun.write(`${ROOT}/package.json`, '{ "name": "mirror-gate", "private": true }')
    await Bun.write(SOURCE, '<script module>\nexport const n = 1\n</script>\n<b>{n}</b>\n')

    await emitAll([ROOT])
    expect(await present(), 'the emit did not write the three files a source owns').toEqual([true, true, true])

    // The source goes the way a rename goes: the file is no longer there, and nothing tells the
    // mirror. This is the whole of the input — an author moving a fixture into a directory.
    await Bun.file(SOURCE).delete()
    await emitAll([ROOT])

    expect(await present(), 'a declaration outlived its source and still answers the import').toEqual([
        false,
        false,
        false,
    ])

    await Bun.$`rm -rf ${ROOT}`.quiet()
})

test('the sweep leaves a source that is still there alone', async () => {
    // The other half, and the one that makes the first safe: keyed on the SOURCE existing rather than
    // on what this run emitted, so checking one subdirectory cannot delete a sibling's mirror.
    await Bun.$`rm -rf ${ROOT}`.quiet()
    await Bun.write(`${ROOT}/package.json`, '{ "name": "mirror-gate", "private": true }')
    await Bun.write(SOURCE, '<script module>\nexport const n = 1\n</script>\n<b>{n}</b>\n')
    await Bun.write(`${ROOT}/pages/kept.abide`, '<b>kept</b>\n')

    await emitAll([ROOT])
    expect(await exists(`${MIRROR}/pages/kept.abide.ts`)).toBe(true)

    // Emit a SUBDIRECTORY only. `pages/kept.abide` is not scanned this time and must survive anyway.
    await emitAll([`${ROOT}/pages`])
    expect(await exists(`${MIRROR}/pages/kept.abide.ts`), 'a partial check swept a mirror it did not emit').toBe(true)
    expect(await exists(`${MIRROR}/widget.abide.ts`), 'a partial check swept a sibling it did not emit').toBe(true)

    await Bun.$`rm -rf ${ROOT}`.quiet()
})
