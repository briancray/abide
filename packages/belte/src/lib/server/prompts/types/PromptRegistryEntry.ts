import type { Prompt } from './Prompt.ts'

/*
Per-prompt registry record. The MCP dispatcher enumerates this to build
`prompts/list` (description + arguments from the JSON Schema) and to
dispatch `prompts/get` (render the body with the caller's arguments).
jsonSchema stays off the public Prompt shape so the render closure isn't
burdened with metadata it never reads.
*/
export type PromptRegistryEntry = {
    prompt: Prompt
    jsonSchema: Record<string, unknown> | undefined
}
