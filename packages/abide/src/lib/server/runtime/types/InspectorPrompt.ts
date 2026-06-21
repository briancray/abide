/*
One declared MCP prompt projected for the inspector: the serializable facts the
Surface tab renders. The render closure isn't included — what an operator wants
is the prompt's name, what it's for, and the arguments it interpolates, the same
trio `prompts/list` advertises. Prompts are MCP-only, so there are no client
surface flags to show.
*/
export type InspectorPrompt = {
    /* The prompt's name (stamped from its file path under src/mcp/prompts/). */
    name: string
    /* The frontmatter description, when the prompt declared one. */
    description: string | undefined
    /* The argument shape as JSON Schema (from the frontmatter `arguments` list); undefined when it takes none. */
    inputSchema: Record<string, unknown> | undefined
}
