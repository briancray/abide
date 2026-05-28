import { createClient } from './createClient.ts'
import { loadEnvFromBinaryDir } from './loadEnvFromBinaryDir.ts'
import { parseArgvForRpc } from './parseArgvForRpc.ts'
import { printCommandHelp, printTopLevelHelp } from './printHelp.ts'
import type { CliManifest } from './types/CliManifest.ts'

/*
Top-level CLI driver. Loaded by the standalone binary's entry; expects
the bundler-emitted manifest plus the raw argv tail. Flow:

  1. Read .env next to the binary so APP_URL / APP_TOKEN are picked up
     for the common install-tarball case.
  2. Pull the first positional as the subcommand.
  3. --help and `<cmd> --help` print and exit zero.
  4. Otherwise parse the rest of the argv against the manifest entry's
     JSON Schema and dispatch via createClient.

Streaming responses aren't a thing at this layer yet — every RPC tool
goes through decodeResponse (text/JSON). Streaming verbs (jsonl/sse)
will be added when the CLI grows watch/publish subcommands for sockets.
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
    await loadEnvFromBinaryDir()

    const first = argv[0]
    if (!first || first === '--help' || first === '-h') {
        printTopLevelHelp(programName, manifest, banner, footer)
        return 0
    }

    if (argv.includes('--help') || argv.includes('-h')) {
        printCommandHelp(programName, first, manifest)
        return 0
    }

    const entry = manifest[first]
    if (!entry) {
        console.error(
            `${programName}: unknown command "${first}" — run \`${programName} --help\` for the list`,
        )
        return 1
    }

    let args: Record<string, unknown> | undefined
    try {
        args = await parseArgvForRpc(argv.slice(1), entry.jsonSchema)
    } catch (error) {
        console.error(`${programName}: ${error instanceof Error ? error.message : String(error)}`)
        return 1
    }

    const appUrl = process.env.APP_URL
    const appToken = process.env.APP_TOKEN
    const client = createClient({ url: appUrl, token: appToken, manifest })

    try {
        const fn = (client as Record<string, (args?: unknown) => Promise<unknown>>)[first]
        if (!fn) {
            console.error(`${programName}: command "${first}" not in client`)
            return 1
        }
        const result = await fn(args)
        if (typeof result === 'string') {
            process.stdout.write(result)
            if (!result.endsWith('\n')) {
                process.stdout.write('\n')
            }
        } else if (result !== undefined) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
        }
        return 0
    } catch (error) {
        console.error(`${programName}: ${error instanceof Error ? error.message : String(error)}`)
        return 1
    }
}
