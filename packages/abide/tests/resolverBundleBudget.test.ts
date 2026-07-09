/* Bundle-budget diagnostic (ADR-0031 D2): the first consumer of the post-DCE bundle-graph seam.
   A project src module that SURVIVES tree-shaking into the client bundle over the per-input byte
   budget earns a NON-BLOCKING build warning (never a failure). Exercises the real
   abideResolverPlugin against a temp fixture, capturing framework warns through the log tap. */
import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abideResolverPlugin } from '../src/abideResolverPlugin.ts'
import { logTapSlot } from '../src/lib/shared/logTapSlot.ts'
import type { LogRecord } from '../src/lib/shared/types/LogRecord.ts'

let cwd: string
beforeAll(async () => {
    // realpath: macOS mkdtemp yields /var/... but Bun normalizes importers to /private/var/...
    cwd = realpathSync(await mkdtemp(join(tmpdir(), 'abide-budget-')))
    await mkdir(join(cwd, 'src/ui'), { recursive: true })

    // A HEAVY module (~600 KiB of live source) that survives DCE — its export is used by the entry.
    const heavy = `export const bytes = ${JSON.stringify('x'.repeat(600 * 1024))}\n`
    await writeFile(join(cwd, 'src/ui/heavy.ts'), heavy)
    await writeFile(
        join(cwd, 'src/ui/heavyEntry.ts'),
        `import { bytes } from './heavy.ts'\nconsole.log(bytes.length)\n`,
    )

    // A SMALL module well under budget — the entry that must NOT warn.
    await writeFile(join(cwd, 'src/ui/small.ts'), `export const tiny = () => 1\n`)
    await writeFile(
        join(cwd, 'src/ui/smallEntry.ts'),
        `import { tiny } from './small.ts'\nconsole.log(tiny())\n`,
    )
})
afterAll(async () => {
    await rm(cwd, { recursive: true, force: true })
})
afterEach(() => {
    logTapSlot.tap = undefined
})

/* Builds `entry` for the given target, returning every framework warn record the log tap saw. */
async function buildCapturingWarns(entry: string, target: 'client' | 'server') {
    const warns: LogRecord[] = []
    logTapSlot.tap = (record) => {
        if (record.level === 'warn' && record.channel === 'abide') {
            warns.push(record)
        }
    }
    const result = await Bun.build({
        entrypoints: [join(cwd, entry)],
        target: 'browser',
        metafile: true,
        plugins: [abideResolverPlugin({ cwd, target })],
        throw: false,
    })
    return { success: result.success, warns }
}

test('client build warns (non-blocking) on a surviving input over the byte budget', async () => {
    const { success, warns } = await buildCapturingWarns('src/ui/heavyEntry.ts', 'client')
    // Non-blocking: the build still succeeds.
    expect(success).toBe(true)
    const budgetWarn = warns.find((record) => record.msg.includes('over the 512 KiB budget'))
    expect(budgetWarn).toBeDefined()
    expect(budgetWarn?.msg).toContain('src/ui/heavy.ts')
    // The evidence chain names the entry that pulled it in.
    expect(budgetWarn?.msg).toContain('src/ui/heavyEntry.ts')
})

test('a small surviving input does NOT warn', async () => {
    const { success, warns } = await buildCapturingWarns('src/ui/smallEntry.ts', 'client')
    expect(success).toBe(true)
    expect(warns.some((record) => record.msg.includes('budget'))).toBe(false)
})

test('the server target never runs the budget diagnostic', async () => {
    const { warns } = await buildCapturingWarns('src/ui/heavyEntry.ts', 'server')
    expect(warns.some((record) => record.msg.includes('budget'))).toBe(false)
})
