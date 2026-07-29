// Write the generated `src/.abide/health.d.ts` for the project at `dir` (CO2.4).
//
// Called by the lanes that exist to serve the TYPE layer — `dev` (so an editor sees the app's health
// fields while it is being written), `check`, `lsp`, and `build` (so a CI lane that never opens an
// editor still type-checks against the same document). NOT by `start`/`run`/`compile`/`bundle`: those
// only run the app, and a production boot has no business writing into `src/`.
//
// Idempotent, and quiet about it: an unchanged companion is not rewritten, so a dev watch does not
// re-trigger itself through its own output.
//
// NODE APIS, DELIBERATELY — this is the one module in `cli/` that must run under BOTH runtimes. Three
// of its four callers are Bun (`check`, `dev`, `build`), but `lsp` is not: `abide lsp` forwards to
// `node lsp.ts` (`main.ts`'s `forwardLsp`, because tsgo cannot open its pipe under Bun), and node has
// no `Bun` global. A `Bun.file`/`Bun.write` here threw `ReferenceError: Bun is not defined` on that
// path, and `lsp.ts` adopts the companion through a `.catch(() => {})`, so the LSP silently never
// wrote one — the failure surfaced as `health()` typing as the bare baseline in the editor, which is
// exactly what a MISSING tsconfig include looks like. Keep these on `node:fs/promises`.

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { log } from '../shared/log.ts'
import { healthCompanion } from './healthCompanion.ts'

export async function writeHealthCompanion(dir: string): Promise<void> {
    const source = join(dir, 'src')
    // No `src/` at all is not an abide project — say nothing and write nothing.
    if (!existsSync(source)) return
    const target = join(source, '.abide', 'health.d.ts')
    const next = healthCompanion(existsSync(join(source, 'app.ts')))
    if (existsSync(target) && (await readFile(target, 'utf8')) === next) return
    await mkdir(join(source, '.abide'), { recursive: true })
    await writeFile(target, next, 'utf8')
    await warnUnlessIncluded(dir)
}

// A tsconfig `include` wildcard never descends into a dot-directory (see `healthCompanion.ts`), so a
// project whose tsconfig does not NAME `src/.abide` gets a companion no compiler will ever read — and
// the failure is silent: `health()` keeps typing as the bare baseline, exactly as it did before. Said
// once, when the file is written, rather than on every boot.
async function warnUnlessIncluded(dir: string): Promise<void> {
    const tsconfig = join(dir, 'tsconfig.json')
    if (!existsSync(tsconfig)) return
    const text = await readFile(tsconfig, 'utf8')
    if (text.includes('.abide/')) return
    log.channel('abide:health').warn(
        'src/.abide/health.d.ts is generated but your tsconfig does not include it — a TypeScript `include` wildcard skips dot-directories. Add "src/.abide/*.d.ts" to `include` to type health() with your onHealth fields.',
    )
}
