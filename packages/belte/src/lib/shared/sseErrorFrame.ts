/*
The in-band error sentinel for an SSE stream: when a handler's generator
throws, `sse()` emits an `event: error` frame whose data is `{ message }`,
and `streamResponse` re-throws it on the consumer side. Encoder and decoder
live together here so the sentinel (event name + payload shape) has one
definition and can't drift between the two ends of the wire.
*/
export const sseErrorFrame = {
    // Full `event: error` frame for a thrown message, including the SSE delimiters.
    encode(message: string): string {
        return `event: error\ndata: ${JSON.stringify({ message })}\n\n`
    },
    /*
    The message carried by an error frame, or undefined when `event` isn't
    the error sentinel. Falls back to the raw data when it isn't the JSON
    the encoder produces.
    */
    decode(event: string, data: string): string | undefined {
        if (event !== 'error') {
            return undefined
        }
        try {
            const decoded = JSON.parse(data) as { message?: string }
            return decoded?.message ?? 'sse stream error'
        } catch {
            return data || 'sse stream error'
        }
    },
}
