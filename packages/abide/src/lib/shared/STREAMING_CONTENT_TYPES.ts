/*
Content-Type prefixes abide treats as streaming bodies — SSE for the
`sse()` helper, JSONL / NDJSON for the `jsonl()` helper. Used by
decodeResponse to refuse a buffered decode and by streamResponse to
choose the frame parser.
*/
export const STREAMING_CONTENT_TYPES = [
    'text/event-stream',
    'application/jsonl',
    'application/x-ndjson',
]
