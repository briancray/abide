import { decodeResponse } from '../shared/decodeResponse.ts'
import { isStreamingResponse } from '../shared/isStreamingResponse.ts'
import { messageFromError } from '../shared/messageFromError.ts'
import { responseErrorText } from '../shared/responseErrorText.ts'
import { streamResponse } from '../shared/streamResponse.ts'

// Frames a value as MCP text content — strings verbatim, everything else as JSON.
// An undefined body (204 / empty) becomes '' — `JSON.stringify(undefined)` is the
// value `undefined`, not a string, which would make an invalid text content block.
function asText(value: unknown): string {
    if (value === undefined) {
        return ''
    }
    return typeof value === 'string' ? value : JSON.stringify(value)
}

/*
Turns an rpc/socket Response into an MCP `tools/call` result. Always
carries a `text` content block for backward compatibility; adds
`structuredContent` (an object, per the MCP spec) so models that
understand structured output get the typed value instead of a stringified
blob.

  - non-2xx        → { content:[text], isError:true }
  - sse/jsonl body → drained frame-by-frame; structuredContent = { frames }.
                     A mid-stream error surfaces as isError with the
                     frames collected so far.
  - object body    → structuredContent = the object.
  - array/primitive → text only (structuredContent must be an object).
*/
export async function toolResultFromResponse(response: Response): Promise<Record<string, unknown>> {
    if (!response.ok) {
        return {
            content: [{ type: 'text', text: await responseErrorText(response) }],
            isError: true,
        }
    }

    if (isStreamingResponse(response)) {
        const frames: unknown[] = []
        try {
            for await (const frame of streamResponse(response)) {
                frames.push(frame)
            }
        } catch (error) {
            return {
                content: [
                    { type: 'text', text: frames.map(asText).join('\n') },
                    {
                        type: 'text',
                        text: `stream error: ${messageFromError(error)}`,
                    },
                ],
                structuredContent: { frames },
                isError: true,
            }
        }
        return {
            content: [{ type: 'text', text: frames.map(asText).join('\n') }],
            structuredContent: { frames },
        }
    }

    const body = await decodeResponse(response)
    const result: Record<string, unknown> = {
        content: [{ type: 'text', text: asText(body) }],
    }
    if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
        result.structuredContent = body
    }
    return result
}
