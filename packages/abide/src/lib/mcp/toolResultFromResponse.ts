import { decodeResponse } from '../shared/decodeResponse.ts'
import { isStreamingResponse } from '../shared/isStreamingResponse.ts'
import { messageFromError } from '../shared/messageFromError.ts'
import { responseErrorText } from '../shared/responseErrorText.ts'
import { streamResponse } from '../shared/streamResponse.ts'

/* MCP `tools/call` is request/response, not a streaming transport, so a genuinely live
   stream must be bounded: return what arrived within these limits (with a truncation note)
   rather than buffering forever and never answering. */
const MAX_STREAM_FRAMES = 1000
const STREAM_TOOL_TIMEOUT_MS = 30_000

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
Turns an RPC Response into an MCP `tools/call` result. Always
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
        // Set when WE stop the stream (cap/timeout), so the iterator's resulting end/throw
        // reads as truncation, not a stream error.
        let truncated: string | undefined
        const timer = setTimeout(() => {
            truncated = `stream truncated after ${STREAM_TOOL_TIMEOUT_MS}ms — MCP tools/call is request/response, not a live stream`
            void response.body?.cancel()
        }, STREAM_TOOL_TIMEOUT_MS)
        try {
            for await (const frame of streamResponse(response)) {
                frames.push(frame)
                if (frames.length >= MAX_STREAM_FRAMES) {
                    truncated = `stream truncated at ${MAX_STREAM_FRAMES} frames`
                    void response.body?.cancel()
                    break
                }
            }
        } catch (error) {
            /* A real mid-stream error (we didn't cancel) surfaces as isError; a throw caused
               by our own cancel falls through to the truncated result below. */
            if (truncated === undefined) {
                clearTimeout(timer)
                return {
                    content: [
                        { type: 'text', text: frames.map(asText).join('\n') },
                        { type: 'text', text: `stream error: ${messageFromError(error)}` },
                    ],
                    structuredContent: { frames },
                    isError: true,
                }
            }
        } finally {
            clearTimeout(timer)
        }
        const content: { type: 'text'; text: string }[] = [
            { type: 'text', text: frames.map(asText).join('\n') },
        ]
        if (truncated !== undefined) {
            content.push({ type: 'text', text: truncated })
        }
        return {
            content,
            structuredContent: truncated === undefined ? { frames } : { frames, truncated },
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
