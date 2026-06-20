import { contentBodyKind } from './contentBodyKind.ts'
import { contentTypeOf } from './contentTypeOf.ts'

/*
Whether a Response carries a streaming body (SSE / JSONL / NDJSON) by its
Content-Type, so callers drain it frame-by-frame instead of buffering. The
streaming bucket of the shared `contentBodyKind` classification. Shared by the
CLI print path and the MCP tool dispatcher.
*/
export function isStreamingResponse(response: Response): boolean {
    return contentBodyKind(contentTypeOf(response.headers)) === 'streaming'
}
