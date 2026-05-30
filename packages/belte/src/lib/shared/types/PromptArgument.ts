/*
A single declared argument of a markdown prompt, parsed from the file's
YAML frontmatter `arguments:` list. `name` is the placeholder the body
interpolates via `{{name}}`; `description` + `required` feed the argument
list MCP advertises in `prompts/list`. Build-time only — markdown prompts
carry no runtime schema object, so this drives the generated JSON Schema.
*/
export type PromptArgument = {
    name: string
    description?: string
    required?: boolean
}
