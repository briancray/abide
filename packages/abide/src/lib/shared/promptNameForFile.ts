/*
Translates a prompt file path under `src/mcp/prompts/` into the prompt's
MCP name. Strips `.md` and joins nested folder segments with `-` (e.g.
`code/review.md` → `code-review`) so two prompts with the same stem in
different folders don't collide and the name stays a single valid MCP
prompt identifier.
*/
export function promptNameForFile(relativePath: string): string {
    return relativePath.replace(/\.md$/, '').replaceAll('/', '-')
}
