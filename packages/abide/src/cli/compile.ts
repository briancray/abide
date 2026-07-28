// compile(dir, options) — `abide compile`: the standalone executable (BP1.6-1.7 + MS3).
//
// The binary IS the app: `./app serve` hosts it, `./app <rpc> [flags]` dispatches that rpc, and a bare
// `./app` opens the interactive REPL. There is no build-time mode to choose, and no separate CLI
// build, because there was never a real difference between the two artifacts — the whole command
// surface costs 16 KB in a 67 MB executable.
//
// The work is `stageCompileEntry` (which turns every lookup `abide start` performs at runtime into a
// build-time one, and writes a generated entry that states the result literally) plus one Bun linker
// run per target. Staging once is what makes `--platforms` cheap: the client build, the AOT-emitted
// pages and the baked schema map are target-independent, so a five-platform release pays for them once.

import { join } from 'node:path'
import { compileExecutable } from './compileExecutable.ts'
import { stageCompileEntry } from './stageCompileEntry.ts'

export interface CompileOptions {
    // A single `bun build --compile` target triple (`bun-linux-x64`, …). Absent = host. Ignored when
    // `platforms` is set.
    target?: string | undefined
    // Where to write. With one target this is the executable PATH; with `platforms` it is the output
    // DIRECTORY (each platform needs its own filename, so one path cannot name them all).
    out?: string | undefined
    // Cross-compile one binary per target triple. An EMPTY array means `--platforms` was passed with no
    // value — take the default release set.
    platforms?: string[] | undefined
}

// The default `--platforms` set: the targets a released binary is expected to cover. Kept short and
// explicit rather than derived from Bun's full target list — a release matrix is a decision, not a
// capability list, and every extra triple is another linker run.
export const DEFAULT_COMPILE_PLATFORMS = [
    'bun-linux-x64',
    'bun-linux-arm64',
    'bun-darwin-x64',
    'bun-darwin-arm64',
    'bun-windows-x64',
] as const

// `bun-windows-x64` produces a PE executable; name it as one. Bun appends `.exe` itself when it is
// missing, so spelling it here only makes the returned path match the file that lands on disk.
function executableName(name: string, target: string): string {
    const suffix = target.includes('windows') ? '.exe' : ''
    return `${name}-${target}${suffix}`
}

export async function compile(dir: string, options: CompileOptions = {}): Promise<string[]> {
    const staged = await stageCompileEntry(dir)

    if (options.platforms === undefined) {
        const outfile = options.out ?? join(dir, 'dist', staged.name)
        return [await compileExecutable(dir, staged.entryPath, outfile, options.target)]
    }

    const targets =
        options.platforms.length > 0 ? options.platforms : [...DEFAULT_COMPILE_PLATFORMS]
    const outDir = options.out ?? join(dir, 'dist')
    const built: string[] = []
    // Sequential on purpose: `bun build --compile` is already parallel internally, and a five-way fan-out
    // would interleave five progress streams onto one terminal for no wall-clock win.
    for (const target of targets) {
        const outfile = join(outDir, executableName(staged.name, target))
        built.push(await compileExecutable(dir, staged.entryPath, outfile, target))
    }
    return built
}
