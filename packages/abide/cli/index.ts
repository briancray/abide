#!/usr/bin/env bun
// The `abide` binary.
//
// Three facts and nothing else: the command table is the help screen, a command's number is the exit
// code, and asking for help is a SUCCESS. That last one is not a nicety — `abide --help` exiting
// non-zero, or a mistyped subcommand exiting `0`, is the shape of bug that tells CI a build worked.
//
// Argument parsing is deliberately one level deep: the first word is the command and everything after
// it belongs to that command. No global flags, so there is nothing to decide about where a `--port`
// after a subcommand was meant to go, and `abide run x.ts --help` reaches the script rather than
// being answered here.

import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import { COMMANDS, commandNamed, usage, usageOf } from './COMMANDS.ts'

// The binary's own module face. What a caller wants from here is the same table the screen is built
// from, so a test can assert the two agree.
export { CLI_EXIT_CODES, type CliExitCode, exitForStatus } from './CLI_EXIT_CODES.ts'
// What `abide build` wrote, as a shape — so a server serving the bundle reads the manifest without
// importing the bundler that produced it. Nothing heavy behind it, for the same reason as above: its
// imports are the table of reserved addresses and `node:path`, which is constants and a builtin.
export {
    CLIENT_DIR,
    CLIENT_ROUTE,
    type ClientAsset,
    type ClientManifest,
    type Encoding,
    GENERATED_ENTRY,
    MANIFEST_FILE,
    type Sidecar,
} from './CLIENT_BUILD.ts'
export { COMMANDS, type Command, commandNamed, usage } from './COMMANDS.ts'
// The REPL's line editor, which takes its terminal as HOOKS — so the one part of this binary that
// cannot be driven by spawning a process (a keystroke needs a tty) is driven by feeding it a string.
export { type EditorHooks, LineEditor, suggest } from './internal/editor.ts'

/**
 * The whole binary as one function, so it is testable without a process: argv in, exit code out.
 *
 * `argv` is what follows the executable — `Bun.argv.slice(2)` at the bottom of this file.
 */
export async function cli(argv: string[]): Promise<number> {
    const name = argv[0]
    if (name === undefined || name === '-h' || name === '--help') {
        console.log(usage())
        return CLI_EXIT_CODES.ok
    }

    const command = commandNamed(name)
    if (command === undefined) {
        // stderr and `2`. A command that is not there was not attempted, which is a different thing
        // from one that ran and failed — and the list is printed with it, because the answer to
        // "what did you mean" is short enough to just say.
        console.error(`abide: unknown command \`${name}\``)
        console.error(`       try one of: ${COMMANDS.map((one) => one.name).join(', ')}`)
        return CLI_EXIT_CODES.usage
    }

    // `abide dev --help` asked this binary something and used to be told `unknown option --help` with
    // a `2` — the one exit code that means "you typed it wrong" answering the request for how to type
    // it. The FIRST position only, so `abide run x.ts --help` still reaches the script: a command whose
    // arguments are opaque has the file in that slot, and everything past it is untouched.
    const rest = argv.slice(1)
    if (rest[0] === '-h' || rest[0] === '--help') {
        console.log(usageOf(command))
        return CLI_EXIT_CODES.ok
    }

    const body = await command.load()
    return body(rest)
}

if (import.meta.main) process.exit(await cli(Bun.argv.slice(2)))
