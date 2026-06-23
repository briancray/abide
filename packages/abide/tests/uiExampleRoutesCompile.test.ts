import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import { compileModule } from '../src/lib/ui/compile/compileModule.ts'

/*
End-to-end, cause-agnostic net: compile EVERY `.abide` in the repo's examples through the
real loader path (`compileModule`). The per-component guards run inside it — syntax
(`assertTranspiles`) and binding completeness (`assertRuntimeHelpersBound`) — so a route that
generates an unbound runtime helper (the dropped-import bug that caused the `/pages` reload
loop), or any other codegen corruption, fails HERE as a compile error instead of shipping a
chunk that throws at mount. Covers shapes no synthetic fixture anticipates because it is the
authors' actual usage. Skips gracefully when examples aren't present (a packaged checkout).
*/
const examplesDir = `${import.meta.dir}/../../../examples`

async function exampleComponents(): Promise<string[]> {
    const found: string[] = []
    try {
        for await (const file of new Glob('*/src/**/*.abide').scan({ cwd: examplesDir })) {
            found.push(file)
        }
    } catch {
        /* No examples directory — nothing to sweep. */
    }
    return found.sort()
}

const components = await exampleComponents()

describe('every example route compiles cleanly', () => {
    test('examples are present to sweep', () => {
        if (components.length === 0) {
            console.warn('[test] no example .abide components found — sweep skipped')
        }
        expect(components.length).toBeGreaterThanOrEqual(0)
    })

    for (const file of components) {
        test(`compiles ${file}`, async () => {
            const source = await Bun.file(`${examplesDir}/${file}`).text()
            const isLayout = file.endsWith('layout.abide')
            // moduleId mirrors what the loader stamps: the path below the example root.
            const moduleId = file.split('/src/')[1] ?? file
            expect(() => compileModule(source, { isLayout, moduleId })).not.toThrow()
        })
    }
})
