import type { PromptMessage } from './PromptMessage.ts'

/*
An MCP prompt declared once with `prompt(opts)` inside a file under
`src/server/prompts/`. The bundler stamps in the `name` from the file
path; `render(args)` produces the messages returned by `prompts/get`.
Prompts are MCP-only — there is no client-side counterpart, so the
shape carries no ClientFlags.
*/
export type Prompt<Args = Record<string, string>> = {
    readonly name: string
    readonly description: string | undefined
    render(args: Args): PromptMessage[] | string | Promise<PromptMessage[] | string>
}
