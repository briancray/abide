/*
One entry in an MCP resources/read result. Text-typed resources carry `text`;
everything else carries base64 `blob` — exactly one is present.
*/
export type McpResourceContents = {
    uri: string
    mimeType: string
    text?: string
    blob?: string
}
