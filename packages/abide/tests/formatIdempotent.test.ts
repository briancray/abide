// 38.137 — `abide format` IS IDEMPOTENT over every `.abide` the repo holds: what one run writes, a
// second leaves as it is. Each file is asked twice — as written, and with every line moved right one
// indent and a block comment of two lines opening every `<script>` and `<style>`, which puts every
// piece somewhere other than where the formatter would have it, so a file the repo already keeps
// formatted still has something to say.

import { expect, test } from 'bun:test'

import { formatAbide } from '#compiler/formatAbide.ts'

const REPO = new URL('../../../', import.meta.url).pathname
const FILES_AT_ONCE = 8

// THE REVERT: hand `bun fmt` each piece as it stands rather than `dedented`; every `.abide` with a
// multi-line block comment below the top level moves on its second run.
test('a formatted .abide formats to itself, for every .abide in the repo', async () => {
    const paths: string[] = []
    for (const name of new Bun.Glob('packages/**/*.abide').scanSync({
        cwd: REPO,
    }))
        if (!name.includes('node_modules/') && !name.includes('/.'))
            paths.push(`${REPO}${name}`)
    expect(paths.length).toBeGreaterThan(100)
    const moved: string[] = []
    let next = 0
    const take = async (): Promise<void> => {
        while (next < paths.length) {
            const path = paths[next] as string
            next += 1
            const written = await Bun.file(path).text()
            const shifted = written
                .replace(/^(?=.)/gm, '    ')
                .replace(
                    /^(\s*)(<(?:script|style)\b[^>]*>)$/gm,
                    '$1$2\n$1    /* one\n$1       two */',
                )
            for (const source of [written, shifted]) {
                const once = (await formatAbide(path, source)).text
                if (once === source) continue
                const twice = (await formatAbide(path, once)).text
                if (twice !== once) moved.push(path.slice(REPO.length))
            }
        }
    }
    await Promise.all(Array.from({ length: FILES_AT_ONCE }, take))
    expect(moved).toEqual([])
}, 120_000)
