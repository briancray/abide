/*
Content-Type prefixes abide treats as streaming bodies — SSE for the
`sse()` helper, JSONL / NDJSON for the `jsonl()` helper. Used by
contentBodyKind (called by decodeResponse and the one-shot path in
streamResponse) to classify content, and by streamResponse to select the
JSONL frame parser.
*/
export const STREAMING_CONTENT_TYPES = [
    'text/event-stream',
    'application/jsonl',
    'application/x-ndjson',
]
