import { STREAMING_CONTENT_TYPES } from './STREAMING_CONTENT_TYPES.ts'

/*
The single classification of a Content-Type into the body kind that decides how
its bytes become a value. One ordering, read by every decoder, so the live read
(`decodeResponse`) and the synchronous warm read (`warmValueFromSnapshot`) cannot
classify the same body differently — the divergence that shipped a warm value a
live read rejected (the streaming-guard-in-one-but-not-the-other bug).

`streaming` is tested FIRST and the order is load-bearing: `application/jsonl`
and `application/x-ndjson` both contain `json`, so a json-first scan would
mis-bucket a stream as parseable JSON.
*/
export type ContentBodyKind = 'streaming' | 'json' | 'text' | 'binary'

export function contentBodyKind(contentType: string): ContentBodyKind {
    if (STREAMING_CONTENT_TYPES.some((type) => contentType.startsWith(type))) {
        return 'streaming'
    }
    if (contentType.includes('json')) {
        return 'json'
    }
    if (contentType.startsWith('text/')) {
        return 'text'
    }
    return 'binary'
}
