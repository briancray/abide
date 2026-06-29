/* Resolution-cache freshness across builds: a `$shared` alias resolved before
   its target file exists must NOT stay "not found" on a later build with the
   same plugin instance (dev watch reuses the instance). onStart clears the
   per-build memo, so the second build re-stats and resolves the new file. */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abideResolverPlugin } from '../src/abideResolverPlugin.ts'

let cwd: string
beforeAll(async () => {
    cwd = realpathSync(await mkdtemp(join(tmpdir(), 'abide-cache-')))
    await mkdir(join(cwd, 'src/shared'), { recursive: true })
    await mkdir(join(cwd, 'src/ui'), { recursive: true })
    // Entry imports an EXTENSIONLESS $shared alias. resolveExtension must add the
    // `.ts` (the stale-miss path): on the first build the file is absent, so it
    // returns the bare path unchanged and caches that miss; on rebuild the cache
    // would otherwise hand back the bare path and the now-existing late.ts is never
    // found. The extensionless form is what makes the cached miss observable.
    await writeFile(
        join(cwd, 'src/ui/page.ts'),
        `import { value } from '$shared/late'\nexport const x = value\n`,
    )
})
afterAll(async () => {
    await rm(cwd, { recursive: true, force: true })
})

test('a file created between builds resolves on the second build (no stale cached miss)', async () => {
    // Single plugin instance, reused across both builds like dev watch does.
    const plugin = abideResolverPlugin({ cwd, target: 'client' })
    const buildOnce = () =>
        Bun.build({
            entrypoints: [join(cwd, 'src/ui/page.ts')],
            target: 'browser',
            plugins: [plugin],
            throw: false,
        })

    // First build: $shared/late.ts is missing → unresolved import, build fails.
    const first = await buildOnce()
    expect(first.success).toBe(false)

    // Create the file, then rebuild with the SAME plugin instance.
    await writeFile(join(cwd, 'src/shared/late.ts'), `export const value = 1\n`)
    const second = await buildOnce()
    expect(second.success).toBe(true)
})
