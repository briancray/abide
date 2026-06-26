import { clearLastConnection } from '../shared/clearLastConnection.ts'
import { loadEnvFromDataDir } from '../shared/loadEnvFromDataDir.ts'
import { messageFromError } from '../shared/messageFromError.ts'
import { connectToServer } from './connectToServer.ts'
import { dispatchCommand } from './dispatchCommand.ts'
import { loadEnvFromBinaryDir } from './loadEnvFromBinaryDir.ts'
import { printCommandHelp, printTopLevelHelp } from './printHelp.ts'
import { printTrimmed } from './printTrimmed.ts'
import { resolveCliTarget } from './resolveCliTarget.ts'
import { runSession } from './runSession.ts'
import { startLocalInstance } from './startLocalInstance.ts'
import type { CliManifest } from './types/CliManifest.ts'
import type { CliTarget } from './types/CliTarget.ts'

const isHelpFlag = (arg: string): boolean => arg === '--help' || arg === '-h'

/*
Whether a command's argv tail genuinely requests help, i.e. a help flag appears
at a flag position rather than as the value of a value-expecting flag. Mirrors
parseArgvForRpc's flag rule: boolean props (and `--name=…`) consume no following
token, everything else consumes the next token as its value — so `--title --help`
passes `--help` as the title value, not a help request.
*/
function commandArgvRequestsHelp(
    argvTail: string[],
    jsonSchema: Record<string, unknown> | undefined,
): boolean {
    const properties =
        (jsonSchema?.properties as Record<string, { type?: string }> | undefined) ?? {}
    for (let index = 0; index < argvTail.length; index += 1) {
        const token = argvTail[index] as string
        if (isHelpFlag(token)) {
            return true
        }
        if (!token.startsWith('--')) {
            continue
        }
        if (token === '--json') {
            index += 1 // consumes its value
            continue
        }
        const rawName = token.slice('--'.length)
        if (rawName.includes('=')) {
            continue // inline value, consumes no following token
        }
        const name = rawName.startsWith('no-') ? rawName.slice('no-'.length) : rawName
        if (properties[name]?.type !== 'boolean') {
            index += 1 // a value-expecting flag consumes the next token
        }
    }
    return false
}

/*
Top-level CLI driver for the standalone binary. The binary is a thin remote client
— it carries no handler code, so it always talks to a running server over HTTP, but
it can boot one: the full binary ships the server beside it, so `/start` spawns a
local instance. One rule governs the first positional — `/` manages the connection,
a bare word runs a command:

  --help / -h                     → top-level help
  /help [cmd]                     → help (per-command with an arg)
  (none) + TTY                    → interactive session, resuming the saved connection
  (none) + non-TTY                → top-level help (scripts use `<cmd>` one-shot)
  /connect <url>                  → connect to a remote server, open a session
  /start                          → boot a local instance, open a session
  /disconnect                     → forget the saved connection, exit
  <cmd> [--flags]                 → one-shot RPC against the resumed target

The connection rpcs are `/`-prefixed only — no bare aliases — so a bare word is
always an RPC command and never collides. Env layers ABIDE_APP_URL/ABIDE_APP_TOKEN (shell >
data-dir > binary-dir) supply the baked default a fresh download resumes against.
*/
export async function runCli({
    programName,
    manifest,
    banner = '',
    footer = '',
    argv,
}: {
    programName: string
    manifest: CliManifest
    banner?: string
    footer?: string
    argv: string[]
}): Promise<number> {
    await loadEnvFromDataDir(programName)
    await loadEnvFromBinaryDir()

    const first = argv[0]

    // Explicit help, top-level and per-command.
    if (first && isHelpFlag(first)) {
        printTopLevelHelp(programName, manifest, banner, footer)
        return 0
    }
    if (first === '/help') {
        if (argv[1]) {
            printCommandHelp(programName, argv[1], manifest)
        } else {
            printTopLevelHelp(programName, manifest, banner, footer)
        }
        return 0
    }
    if (first && commandArgvRequestsHelp(argv.slice(1), manifest[first]?.jsonSchema)) {
        printCommandHelp(programName, first, manifest)
        return 0
    }

    // No command: interactive session on a TTY, help otherwise (scripts/pipes).
    if (!first) {
        if (!process.stdin.isTTY) {
            printTopLevelHelp(programName, manifest, banner, footer)
            return 0
        }
        printTrimmed(banner)
        const target = await resolveCliTarget(programName)
        return runSession({ programName, manifest, footer, target })
    }

    // Disconnect (reset): clear the saved connection and exit.
    if (first === '/disconnect') {
        await clearLastConnection(programName)
        console.log('disconnected')
        return 0
    }

    // Connect to a remote server, then open a session.
    if (first === '/connect') {
        const url = argv[1]
        if (!url) {
            console.error(`${programName}: /connect requires a url`)
            return 1
        }
        printTrimmed(banner)
        const target = await connectToServer(programName, url)
        if (!target) {
            return 1
        }
        return runSession({ programName, manifest, footer, target })
    }

    // Start a local instance, then open a session.
    if (first === '/start') {
        printTrimmed(banner)
        let target: CliTarget
        try {
            target = await startLocalInstance(programName)
        } catch (error) {
            console.error(`${programName}: ${messageFromError(error)}`)
            return 1
        }
        return runSession({ programName, manifest, footer, target })
    }

    // One-shot RPC dispatch (scripting): resolve the target without a session.
    const target = await resolveCliTarget(programName)
    if (!target) {
        console.error(
            `${programName}: not connected — run \`${programName} /connect <url>\` or \`${programName} /start\``,
        )
        return 1
    }
    const code = await dispatchCommand({
        programName,
        manifest,
        command: first,
        argvTail: argv.slice(1),
        url: target.url,
        token: target.token,
    })
    // Reap any local instance booted just to resolve the target.
    target.child?.kill()
    return code
}
