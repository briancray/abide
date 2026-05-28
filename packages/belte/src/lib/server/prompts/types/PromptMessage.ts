/*
A single message in an MCP prompt's rendered output. `prompt({ render })`
returns either a bare string (sugar for one `user` message) or an array
of these. The dispatcher maps each into the MCP `prompts/get` wire shape
({ role, content: { type: 'text', text } }).
*/
export type PromptMessage = {
    role: 'user' | 'assistant'
    text: string
}
