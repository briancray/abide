// `{{name}}` placeholder, surrounding whitespace tolerated, names are
// word chars or hyphens to match valid MCP argument identifiers.
const PLACEHOLDER = /\{\{\s*([\w-]+)\s*\}\}/g

/*
Renders a markdown prompt body by substituting each `{{name}}` placeholder
with the matching argument value. Missing arguments collapse to an empty
string — MCP only enforces `required` at the client, so an optional
argument the model omits should simply vanish from the text. Called by the
render closure the resolver plugin generates for every `.md` prompt.
*/
export function renderPromptTemplate(template: string, args: Record<string, string>): string {
    return template.replace(PLACEHOLDER, (_match, key: string) =>
        args[key] === undefined ? '' : String(args[key]),
    )
}
