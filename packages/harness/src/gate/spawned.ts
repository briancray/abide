const DEFAULT_DEADLINE_MILLISECONDS = 60_000

/**
 * Runs `command` to its end and hands back its exit code and its whole output.
 *
 * AWAITED, NEVER SYNCHRONOUS. `Bun.spawnSync` in a `bun test --parallel` worker can lose a child's
 * exit: the child is a zombie nobody reaped, and the wait spins at 100% CPU for good. The loop is
 * synchronous, so neither the test's timeout nor `spawnSync`'s own `timeout` is ever reached, and
 * the gate reports nothing at all. Awaited, the event loop stays free: past `deadline` the child is
 * killed and the wait throws with the command in the message, so a lost exit is one failed test.
 */
export async function spawned(
    command: string[],
    options: {
        cwd?: string
        env?: Record<string, string | undefined>
        deadline?: number
    } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const child = Bun.spawn(command, {
        cwd: options.cwd ?? process.cwd(),
        env: options.env ?? process.env,
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const deadline = options.deadline ?? DEFAULT_DEADLINE_MILLISECONDS
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<never>((_, fail) => {
        timer = setTimeout(() => {
            child.kill()
            fail(
                new Error(
                    `\`${command.join(' ')}\` did not finish in ${deadline} ms`,
                ),
            )
        }, deadline)
    })
    try {
        const [exitCode, stdout, stderr] = await Promise.race([
            Promise.all([
                child.exited,
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
            ]),
            expired,
        ])
        return { exitCode, stdout, stderr }
    } finally {
        clearTimeout(timer)
    }
}
