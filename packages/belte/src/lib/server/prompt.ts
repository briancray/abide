import type { Prompt } from './prompts/types/Prompt.ts'
import type { PromptOptions } from './prompts/types/PromptOptions.ts'
import type { StandardSchemaV1 } from './rpc/types/StandardSchemaV1.ts'

/*
Declares an MCP prompt inside a file under `src/server/prompts/`. Each
file contains exactly one export, named after the file (e.g.
`summarize.ts` → `export const summarize = prompt(...)`). The bundler
reads the export name from the filename and the prompt name from the file
path under `src/server/prompts/`, then rewrites this call to bind the name
into definePrompt.

`render(args)` returns the messages MCP hands back for `prompts/get`:
either a bare string (one user message) or an explicit message array.
When `schema` is set, `Args` infers from `InferOutput<Schema>`, incoming
arguments validate against it, and MCP advertises the argument list in
`prompts/list`.

This function exists only for the type signature; calling it directly
means the bundler plugin didn't process the file, which throws.
*/
export function prompt<Schema extends StandardSchemaV1>(
    opts: PromptOptions<StandardSchemaV1.InferOutput<Schema>> & { schema: Schema },
): Prompt<StandardSchemaV1.InferOutput<Schema>>
export function prompt<Args = Record<string, string>>(opts: PromptOptions<Args>): Prompt<Args>
export function prompt(_opts: PromptOptions): Prompt {
    throw new Error(
        '[belte] `prompt(...)` was called outside a prompts module — the prompt helper is only valid as the value of `export const <filename> = ...` inside a file under src/server/prompts/',
    )
}
