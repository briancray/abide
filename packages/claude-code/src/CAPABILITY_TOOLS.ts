/* Closed set of site-requestable capabilities, each mapped to the Claude Code
built-in tool it enables. Network-read only — nothing that touches the user's
shell or filesystem. Dangerous tools (Bash/Write/Edit) are absent by
construction, so neither the page API nor the serve flag vocabulary can name
them; the page can only request from this set, and the user still runs the
visible command to grant it. */
export const CAPABILITY_TOOLS = {
    webSearch: 'WebSearch',
    webFetch: 'WebFetch',
} as const
