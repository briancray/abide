/*
The in-band error sentinel for a JSONL/NDJSON stream: when a handler's
generator throws, `jsonl()` emits a final `{"$error":"<message>"}` line,
and `streamResponse` re-throws it on the consumer side. Encoder and decoder
live together here so the sentinel field has one definition and can't drift
between the two ends of the wire.
*/
export const jsonlErrorFrame = {
    // Error line for a thrown message, including the trailing newline.
    encode(message: string): string {
        return `${JSON.stringify({ $error: message })}\n`
    },
    // The message carried by a parsed line, or undefined when it isn't the error sentinel.
    decode(parsed: unknown): string | undefined {
        if (
            parsed &&
            typeof parsed === 'object' &&
            typeof (parsed as { $error?: unknown }).$error === 'string'
        ) {
            return (parsed as { $error: string }).$error
        }
        return undefined
    },
}
