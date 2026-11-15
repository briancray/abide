/**
 * Runs `command`, throwing with what it said where it fails.
 *
 * Its stderr is drained beside its exit, so a tool that fills the pipe is not left waiting on a
 * reader.
 */
export async function ran(command: string[]): Promise<void> {
    const child = Bun.spawn(command, { stdout: 'ignore', stderr: 'pipe' })
    const [code, said] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
    ])
    if (code !== 0)
        throw new Error(
            `${command[0]} failed: ${said.trim() || `exit ${code}`}`,
        )
}
