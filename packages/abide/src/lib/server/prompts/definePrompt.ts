import { registerPrompt } from './registerPrompt.ts'
import type { Prompt } from './types/Prompt.ts'
import type { PromptOptions } from './types/PromptOptions.ts'

/*
Builds a Prompt from a name + options. The resolver plugin parses every
`src/mcp/prompts/<file>.md` and generates a module that calls
`definePrompt("<name>", { description, jsonSchema, render })`, so the file
path becomes the prompt's identity. Registers itself so the MCP dispatcher
can enumerate and render it.
*/
// @documentation plumbing
export function definePrompt(name: string, opts: PromptOptions): Prompt {
    const self: Prompt = {
        name,
        description: opts.description,
        render: opts.render,
    }
    registerPrompt({ prompt: self, jsonSchema: opts.jsonSchema })
    return self
}
