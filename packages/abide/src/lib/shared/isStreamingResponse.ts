import { STREAMING_CONTENT_TYPES } from './STREAMING_CONTENT_TYPES.ts'

/*
Whether a Response carries a streaming body (SSE / JSONL / NDJSON) by its
Content-Type, so callers drain it frame-by-frame instead of buffering.
Shared by the CLI print path and the MCP tool dispatcher.
*/
export function isStreamingResponse(response: Response): boolean {
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    return STREAMING_CONTENT_TYPES.some((type) => contentType.startsWith(type))
}
