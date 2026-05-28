import type { PromptRegistryEntry } from './types/PromptRegistryEntry.ts'

/*
Process-wide registry of every prompt declared in the app. definePrompt
inserts on first construction (eagerly when the registry loader walks the
prompts manifest at MCP boot). The MCP server reads this to build its
`prompts/list` + `prompts/get` responses.
*/
export const promptRegistry = new Map<string, PromptRegistryEntry>()
