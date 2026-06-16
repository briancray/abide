/*
An MCP prompt declared by a markdown file under `src/mcp/prompts/`. The
resolver plugin parses the file's frontmatter + body and generates a call
to definePrompt, stamping in the `name` from the file path; `render(args)`
interpolates the body's `{{name}}` placeholders into the single user
message returned by `prompts/get`. Prompts are MCP-only — there is no
client-side counterpart, so the shape carries no ClientFlags.
*/
export type Prompt = {
    readonly name: string
    readonly description: string | undefined
    render(args: Record<string, string>): string
}
