import type { StandardSchemaV1 } from '../../rpc/types/StandardSchemaV1.ts'
import type { Prompt } from './Prompt.ts'

/*
Per-prompt registry record. The MCP dispatcher enumerates this to build
`prompts/list` (description + arguments from the schema) and to dispatch
`prompts/get` (validate args against the schema, then render). Schema +
jsonSchema stay off the public Prompt shape so the render closure isn't
burdened with metadata it never reads.
*/
export type PromptRegistryEntry = {
    prompt: Prompt
    schema: StandardSchemaV1 | undefined
    jsonSchema: Record<string, unknown> | undefined
}
