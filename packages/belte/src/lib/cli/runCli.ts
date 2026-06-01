import { decodeResponse } from '../shared/decodeResponse.ts'
import { isStreamingResponse } from '../shared/isStreamingResponse.ts'
import { responseErrorText } from '../shared/responseErrorText.ts'
import { streamResponse } from '../shared/streamResponse.ts'
import { createClient } from './createClient.ts'
import { loadEnvFromBinaryDir } from './loadEnvFromBinaryDir.ts'
import { parseArgvForRpc } from './parseArgvForRpc.ts'
import { printCommandHelp, printTopLevelHelp } from './printHelp.ts'
import type { CliManifest } from './types/CliManifest.ts'

const isHelpFlag = (arg: string): boolean => arg === '--help' || arg === '-h'

// String results print verbatim (with a trailing newline); everything else as a JSON line.
function printValue(value: unknown, pretty: boolean): void {
    if (typeof value === 'string') {
        process.stdout.write(value.endsWith('\n') ? value : `${value}\n`)
        return
    }
    if (value !== undefined) {
        process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`)
    }
}

/*
Top-level CLI driver. Loaded by the standalone binary's entry; expects
the bundler-emitted manifest plus the raw argv tail. The binary is a
thin remote client — it carries no handler code, so it always talks to a
running server over HTTP and APP_URL must be set. Flow:

  1. Read .env next to the binary so APP_URL / APP_TOKEN are picked up
     for the common install-tarball case.
  2. Pull the first positional as the subcommand.
  3. --help and `<cmd> --help` print and exit zero.
  4. Require APP_URL before dispatching a command.
  5. Otherwise parse the rest of the argv against the manifest entry's
     JSON Schema and dispatch via createClient against APP_URL.

Streaming responses are handled by sniffing the response Content-Type:
sse/jsonl bodies (a streaming verb, or a socket `tail` command) are
printed frame-by-frame as NDJSON to stdout; everything else is decoded
and pretty-printed once.
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
    if (!first || isHelpFlag(first)) {
        printTopLevelHelp(programName, manifest, banner, footer)
        return 0
    }

    if (argv.some(isHelpFlag)) {
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
    if (!appUrl) {
        console.error(
            `${programName}: APP_URL is not set — the cli talks to a running server, so point it at one (e.g. APP_URL=http://localhost:3000)`,
        )
        return 1
    }
    const appToken = process.env.APP_TOKEN
    const client = createClient({ url: appUrl, token: appToken, manifest })

    const fn = client[first]
    if (!fn) {
        console.error(`${programName}: command "${first}" not in client`)
        return 1
    }
    try {
        const response = await fn.raw(args)
        if (isStreamingResponse(response)) {
            /*
            Stream frame-by-frame to stdout as NDJSON. streamResponse
            throws a clear HttpError on a non-2xx body, caught below.
            */
            for await (const frame of streamResponse(response)) {
                printValue(frame, false)
            }
            return 0
        }
        if (!response.ok) {
            throw new Error(await responseErrorText(response))
        }
        printValue(await decodeResponse(response), true)
        return 0
    } catch (error) {
        console.error(`${programName}: ${error instanceof Error ? error.message : String(error)}`)
        return 1
    }
}
