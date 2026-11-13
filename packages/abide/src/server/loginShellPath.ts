// How long the visitor's shell may take to say its PATH before the desktop app goes on without it.
const SHELL_MILLISECONDS = 3000

/**
 * The `PATH` the visitor's login shell sets, or `undefined` where it says none in time. 44.80.
 *
 * An app opened from the Finder inherits launchd's `PATH`, which holds none of what a terminal finds —
 * Claude Code, and the `node` an npm install of it runs on — so a desktop app reads the one a terminal
 * would have. Interactive as well as login, because an installer that adds to `PATH` writes the rc file.
 */
export async function loginShellPath(): Promise<string | undefined> {
    const child = Bun.spawn(
        [
            Bun.env.SHELL || '/bin/zsh',
            '-ilc',
            // Between markers, since an rc file may print.
            'printf "__ABIDE_PATH__%s__ABIDE_PATH__" "$PATH"',
        ],
        {
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'ignore',
            signal: AbortSignal.timeout(SHELL_MILLISECONDS),
        },
    )
    const printed = await new Response(child.stdout).text().catch(() => '')
    return /__ABIDE_PATH__(.*)__ABIDE_PATH__/s.exec(printed)?.[1] || undefined
}
