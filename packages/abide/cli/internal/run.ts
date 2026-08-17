// `abide run <file> [args…]` — a script under the abide runtime.
//
// The runtime is one thing: the `.abide` loader. A script run this way imports a component the same
// way a served app does, so a one-off script, a migration and a test all see the same module graph
// as the thing they are poking at.
//
// SPAWNED rather than imported into this process, and that is the whole of what "everything after
// <file> belongs to the script" means: the script reads `Bun.argv`, and in-process it would read the
// CLI's. Rewriting argv underneath it would make `abide run x.ts --help` a lie in the one direction
// that matters — the script's own flags have to reach the script, including the ones this binary
// also answers to.

import { PRELOAD_FILE } from '#compiler/PRELOAD_FILE.ts'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'

export async function run(argv: string[]): Promise<number> {
    const file = argv[0]
    // A leading flag is a mistake rather than a filename: `abide run --help` is somebody asking this
    // binary something, and handing `--help` to `bun` as a script path answers with the wrong tool's
    // error. Everything after the file is untouched, which is where a script's own flags go.
    if (file === undefined || file.startsWith('-')) {
        console.error('abide run: needs a file')
        return CLI_EXIT_CODES.usage
    }

    const child = Bun.spawn(['bun', '--preload', PRELOAD_FILE, file, ...argv.slice(1)], {
        // The script's output IS this command's output. Piping it would buy a copy and lose the one
        // thing a script run from a terminal needs, which is a terminal on the other end of it.
        stdio: ['inherit', 'inherit', 'inherit'],
    })
    await child.exited
    // A script that chose an exit code keeps it — this command is a runtime, not an outcome. Killed
    // by a signal there is no code to keep, and the honest answer is that it did not work.
    return child.exitCode ?? CLI_EXIT_CODES.failed
}
