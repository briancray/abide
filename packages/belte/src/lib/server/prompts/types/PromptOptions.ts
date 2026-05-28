import type { StandardSchemaV1 } from '../../rpc/types/StandardSchemaV1.ts'
import type { PromptMessage } from './PromptMessage.ts'

/*
Server-side options passed when declaring a prompt via `prompt(opts)`.
MCP prompts are read-only templates: `render(args)` turns the caller's
arguments into one or more chat messages. The optional Standard Schema
both validates incoming arguments and supplies the argument list MCP
advertises in `prompts/list` (top-level properties + required array).
All of this is server-only — prompts are never imported by client code.
*/
export type PromptOptions<Args = Record<string, string>> = {
    description?: string
    schema?: StandardSchemaV1
    jsonSchema?: Record<string, unknown>
    render: (args: Args) => PromptMessage[] | string | Promise<PromptMessage[] | string>
}
