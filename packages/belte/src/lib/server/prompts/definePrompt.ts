import { registerPrompt } from './registerPrompt.ts'
import type { Prompt } from './types/Prompt.ts'
import type { PromptOptions } from './types/PromptOptions.ts'

/*
Builds a Prompt from a name + options. The bundler rewrites every
`export const NAME = prompt(opts)` inside `src/server/prompts/<file>.ts`
into `__belteDefinePrompt__("<name>", opts)` so the file path becomes the
prompt's identity. Registers itself so the MCP dispatcher can enumerate
and render it.
*/
export function definePrompt(name: string, opts: PromptOptions): Prompt {
    const self: Prompt = {
        name,
        description: opts.description,
        render: opts.render,
    }
    registerPrompt({ prompt: self, schema: opts.schema, jsonSchema: opts.jsonSchema })
    return self
}
