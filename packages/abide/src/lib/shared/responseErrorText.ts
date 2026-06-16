/*
Human-readable message for a non-2xx Response: `status statusText: body`.
Shared by the CLI error path and the MCP tool result so the two frame a
failed request identically. Consumes the body, so call only on a response
you're done with.
*/
export async function responseErrorText(response: Response): Promise<string> {
    return `${response.status} ${response.statusText}: ${await response.text()}`
}
