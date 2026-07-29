// CO2.4 — the generated health companion, asserted the only way that means anything: by COMPILING an
// app against it.
//
// A text assertion cannot guard this contract. The augmentation reaches `health()` through module
// resolution (`abide/shared/health` as an app spells it) and through the tsconfig's `include` (a
// wildcard never descends into a dot-directory), and BOTH failures are silent — the app keeps seeing
// the bare baseline, exactly as it did before any of this existed. So the fixture is compiled twice:
// once with the companion and once without, and the second run must fail on the app's own fields.

import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { healthCompanion } from './healthCompanion.ts'
import { writeHealthCompanion } from './writeHealthCompanion.ts'

// A real project on disk: `src/app.ts` exporting `onHealth`, and a `src/probe.ts` that reads the two
// fields only that hook can supply.
const FIXTURE = join(import.meta.dir, '__fixtures__', 'healthApp')
const COMPANION = join(FIXTURE, 'src', '.abide', 'health.d.ts')
const TSC = join(import.meta.dir, '..', '..', 'node_modules', '.bin', 'tsc')

async function typecheck(): Promise<string> {
    const proc = Bun.spawn([TSC, '--noEmit', '-p', FIXTURE], { stdout: 'pipe', stderr: 'pipe' })
    const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ])
    await proc.exited
    return out + err
}

afterAll(async () => {
    // Leave the fixture in the state a fresh clone has: generated, gitignored, absent.
    await rm(join(FIXTURE, 'src', '.abide'), { recursive: true, force: true })
})

describe('writeHealthCompanion', () => {
    test('the companion is what makes the app fields exist', async () => {
        await rm(join(FIXTURE, 'src', '.abide'), { recursive: true, force: true })
        const without = await typecheck()
        // The proof that the fixture is a real test: without the generated file, reading `onHealth`'s
        // own fields off `health()` does not compile.
        expect(without).toContain("Property 'db' does not exist")
        expect(without).toContain("Property 'queueDepth' does not exist")

        await writeHealthCompanion(FIXTURE)
        expect(existsSync(COMPANION)).toBe(true)
        const withCompanion = await typecheck()
        expect(withCompanion.trim()).toBe('')
    }, 60_000)

    test('an unchanged companion is not rewritten', async () => {
        await writeHealthCompanion(FIXTURE)
        const first = await Bun.file(COMPANION).stat()
        await writeHealthCompanion(FIXTURE)
        const second = await Bun.file(COMPANION).stat()
        // A dev watch that rewrote its own output every save would re-trigger itself forever.
        expect(second.mtimeMs).toBe(first.mtimeMs)
    })

    test('a project with no src/app.ts gets the augmentation-free stub', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'abide-health-'))
        try {
            await Bun.write(join(dir, 'src', 'index.ts'), 'export const x = 1\n')
            await writeHealthCompanion(dir)
            const text = await Bun.file(join(dir, 'src', '.abide', 'health.d.ts')).text()
            expect(text).toBe(healthCompanion(false))
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    test('a directory that is not an abide project is left alone', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'abide-health-'))
        try {
            await writeFile(join(dir, 'README.md'), '# not an app\n')
            await writeHealthCompanion(dir)
            expect(existsSync(join(dir, 'src'))).toBe(false)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    // The LSP is the one caller that is NOT Bun: `abide lsp` forwards to `node lsp.ts`, and node has no
    // `Bun` global. This module used `Bun.file`/`Bun.write`, so that path threw `ReferenceError: Bun is
    // not defined` — and `lsp.ts` adopts the companion through a `.catch(() => {})`, so the LSP silently
    // never wrote one. Every test above runs under Bun and passed throughout. The runtime is the whole
    // contract here, so the guard has to SPAWN node; asserting the file contents under Bun cannot see it.
    test('runs under node — the runtime `abide lsp` actually forwards to', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'abide-health-node-'))
        try {
            await writeFile(join(dir, 'README.md'), '# app\n')
            await mkdir(join(dir, 'src'), { recursive: true })
            await writeFile(join(dir, 'src', 'app.ts'), 'export const middleware = []\n')
            const probe = join(dir, 'probe.mts')
            const module = join(import.meta.dir, 'writeHealthCompanion.ts')
            await writeFile(
                probe,
                `import { writeHealthCompanion } from ${JSON.stringify(module)}\n` +
                    `await writeHealthCompanion(${JSON.stringify(dir)})\n`,
            )
            const proc = Bun.spawn(['node', '--experimental-strip-types', probe], {
                stdout: 'pipe',
                stderr: 'pipe',
            })
            const stderr = await new Response(proc.stderr).text()
            const code = await proc.exited
            expect(stderr).not.toContain('Bun is not defined')
            expect(code).toBe(0)
            expect(existsSync(join(dir, 'src', '.abide', 'health.d.ts'))).toBe(true)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    }, 30_000)
})
