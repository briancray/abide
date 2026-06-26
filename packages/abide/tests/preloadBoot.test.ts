/* Boot smoke test: preload.ts registers abide's plugins via the runtime `plugin()`
   API (the path `bun dev` loads). That builder lacks build-time-only hooks like
   `onStart`, so a hook unguarded for the runtime context crashes the dev server at
   startup with green unit tests — a class diff-scoped review can't catch (the fault
   surfaces from an unchanged file's registration context). Run it in a subprocess so
   the global plugin registration can't leak into the shared test process. */
import { expect, test } from 'bun:test'
import { join } from 'node:path'

const preload = join(import.meta.dir, '../src/preload.ts')

test.each([
    'server',
    'client',
])('preload.ts registers cleanly (ABIDE_TARGET=%s)', async (target) => {
    const proc = Bun.spawn(['bun', preload], {
        env: { ...process.env, ABIDE_TARGET: target },
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
})
