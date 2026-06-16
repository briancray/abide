import { decodeResponse } from '../shared/decodeResponse.ts'
import { isStreamingResponse } from '../shared/isStreamingResponse.ts'
import { responseErrorText } from '../shared/responseErrorText.ts'
import { streamResponse } from '../shared/streamResponse.ts'
import { createClient } from './createClient.ts'
import { parseArgvForRpc } from './parseArgvForRpc.ts'
import { printValue } from './printValue.ts'
import type { CliManifest } from './types/CliManifest.ts'

/*
Runs one RPC command against a target server and prints the result, returning a
process exit code. Shared by the one-shot path (runCli) and the interactive
session (runSession) so a command behaves identically typed at the shell or at
the session prompt. Streaming responses (sse/jsonl — a streaming verb or a socket
`tail`) print frame-by-frame as NDJSON; everything else decodes and prints once.
*/
export async function dispatchCommand({
    programName,
    manifest,
    command,
    argvTail,
    url,
    token,
}: {
    programName: string
    manifest: CliManifest
    command: string
    argvTail: string[]
    url: string
    token?: string
}): Promise<number> {
    const entry = manifest[command]
    if (!entry) {
        console.error(
            `${programName}: unknown command "${command}" — run \`${programName} --help\` for the list`,
        )
        return 1
    }

    let args: Record<string, unknown> | undefined
    try {
        args = await parseArgvForRpc(argvTail, entry.jsonSchema)
    } catch (error) {
        console.error(`${programName}: ${error instanceof Error ? error.message : String(error)}`)
        return 1
    }

    const client = createClient({ url, token, manifest })
    const fn = client[command]
    if (!fn) {
        console.error(`${programName}: command "${command}" not in client`)
        return 1
    }
    try {
        const response = await fn.raw(args)
        if (isStreamingResponse(response)) {
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
