import { printCommandHelp, printTopLevelHelp } from './printHelp.ts'
import type { CliManifest } from './types/CliManifest.ts'

/*
Session `/help`: with a command name, the per-command flag help; otherwise the
meta-command list followed by the RPC command listing (no banner — already shown
at session start).
*/
export function printSessionHelp(
    programName: string,
    manifest: CliManifest,
    command?: string,
): void {
    if (command) {
        printCommandHelp(programName, command, manifest)
        return
    }
    console.log('session commands:')
    console.log('  /connect <url>       connect to a remote server')
    console.log('  /start               start a local instance')
    console.log('  /disconnect          disconnect and forget the saved connection')
    console.log('  /help [command]      show this help, or help for one command')
    console.log('  /clear               clear the screen')
    console.log('  /exit                leave the session')
    console.log('')
    printTopLevelHelp(programName, manifest)
}
