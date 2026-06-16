/*
Options definePrompt receives for one markdown prompt. The resolver plugin
generates this object from the file: `description` + `jsonSchema` come from
the frontmatter (the schema built from the `arguments` list), and `render`
closes over the parsed body. All of this is server-only — prompts are never
imported by client code.
*/
export type PromptOptions = {
    description?: string
    jsonSchema?: Record<string, unknown>
    render: (args: Record<string, string>) => string
}
