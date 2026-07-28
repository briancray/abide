// compileExecutable(dir, entryPath, outfile, target?) — the Bun linker step every compile ends
// in. Split from staging because a cross-compile (`--platforms`) reuses ONE staged entry and
// only re-runs this per target: the client build, the AOT-emitted pages and the baked schemas are
// target-independent, and rebuilding them per platform would be the same work N times.
//
// Runs in the app's directory so `bun build` resolves `abide` and the app's dependencies through the
// app's own `node_modules`, exactly as the generated entry expects.

import { relative } from 'node:path'

export async function compileExecutable(
    dir: string,
    entryPath: string,
    outfile: string,
    target?: string | undefined,
): Promise<string> {
    const argv = ['bun', 'build', '--compile', relative(dir, entryPath), '--outfile', outfile]
    if (target !== undefined) argv.push(`--target=${target}`)
    const proc = Bun.spawn(argv, { cwd: dir, stdio: ['inherit', 'inherit', 'inherit'] })
    const code = await proc.exited
    if (code !== 0) throw new Error(`abide: \`${argv.join(' ')}\` exited ${code}`)
    return outfile
}
