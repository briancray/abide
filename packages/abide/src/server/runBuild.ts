// The CLI, spawned rather than imported: the compiler is not reachable from the server seam.
const ABIDE_BIN = Bun.fileURLToPath(
    new URL('../../bin/abide.ts', import.meta.url),
)

/**
 * `abide build` of the app under `root` into `out`, run as the CLI.
 *
 * SPAWNED RATHER THAN IMPORTED: the compiler is not reachable from the server seam.
 */
export async function runBuild(root: string, out: string): Promise<void> {
    const child = Bun.spawn(
        [process.execPath, ABIDE_BIN, 'build', '--root', root, '--out', out],
        { stdout: 'ignore', stderr: 'pipe' },
    )
    const [exitCode, said] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
    ])
    if (exitCode !== 0)
        throw new Error(
            `abide: could not build the app under ${root}.\n${said}`,
        )
}
