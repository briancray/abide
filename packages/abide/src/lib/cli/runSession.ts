import { clearLastConnection } from '../shared/clearLastConnection.ts'
import { messageFromError } from '../shared/messageFromError.ts'
import { connectToServer } from './connectToServer.ts'
import { dispatchCommand } from './dispatchCommand.ts'
import { printSessionHelp } from './printSessionHelp.ts'
import { printSessionStatus } from './printSessionStatus.ts'
import { printTrimmed } from './printTrimmed.ts'
import { startLocalInstance } from './startLocalInstance.ts'
import { tokenizeLine } from './tokenizeLine.ts'
import type { CliManifest } from './types/CliManifest.ts'
import type { CliTarget } from './types/CliTarget.ts'

/*
Interactive session (REPL). The banner is printed once by the caller; this prints
the status line, then loops reading stdin lines via Bun's async-iterable console:
  - bare words   → dispatch the RPC against the current target
  - /connect <url>, /start, /disconnect, /help, /clear, /exit → meta commands
The session owns the current target's child (a local instance) and reaps it when
the connection is swapped or the loop ends — including on SIGINT.
*/
export async function runSession({
    programName,
    manifest,
    footer,
    target,
}: {
    programName: string
    manifest: CliManifest
    footer: string
    target: CliTarget | undefined
}): Promise<number> {
    let current = target
    // Reap any local instance on Ctrl+C — the closure reads the latest `current`.
    // Named + removed on exit so repeated sessions in one process don't accumulate listeners.
    const onSigint = () => {
        current?.child?.kill()
        process.exit(0)
    }
    process.on('SIGINT', onSigint)

    // Swap the active connection: reap the previous local instance (only one runs
    // at a time), adopt the next target, and reprint the status line.
    async function swap(next: CliTarget | undefined): Promise<void> {
        current?.child?.kill()
        current = next
        await printSessionStatus(current)
    }

    await printSessionStatus(current)
    const promptText = `${programName}> `
    process.stdout.write(promptText)

    for await (const line of console) {
        const tokens = tokenizeLine(line.trim())
        const head = tokens[0]
        if (head === undefined) {
            process.stdout.write(promptText)
            continue
        }
        if (head === '/exit' || head === '/quit') {
            break
        }
        if (head === '/clear') {
            console.clear()
        } else if (head === '/help') {
            printSessionHelp(programName, manifest, tokens[1])
        } else if (head === '/connect') {
            const url = tokens[1]
            if (!url) {
                console.error('/connect requires a url')
            } else {
                const next = await connectToServer(programName, url)
                if (next) {
                    await swap(next)
                }
            }
        } else if (head === '/start') {
            try {
                await swap(await startLocalInstance(programName))
            } catch (error) {
                console.error(`could not start local instance: ${messageFromError(error)}`)
            }
        } else if (head === '/disconnect') {
            await clearLastConnection(programName)
            await swap(undefined)
        } else if (head.startsWith('/')) {
            console.error(`unknown command "${head}" — /help for the list`)
        } else if (!current) {
            console.error('not connected — /connect <url> or /start')
        } else {
            await dispatchCommand({
                programName,
                manifest,
                command: head,
                argvTail: tokens.slice(1),
                url: current.url,
                token: current.token,
            })
        }
        process.stdout.write(promptText)
    }

    process.removeListener('SIGINT', onSigint)
    current?.child?.kill()
    printTrimmed(footer)
    return 0
}
