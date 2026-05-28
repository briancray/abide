import type { Prompt } from './Prompt.ts'

/*
Manifest of prompt-name → module loader. Produced by the resolver plugin
from each `.ts` under src/server/prompts/. Each module has exactly one
named export, a Prompt whose `.name` was stamped in by the bundler
rewrite. The registry loader imports every module once so the MCP
dispatcher can enumerate the full prompt surface.
*/
export type PromptRoutes = Record<string, () => Promise<Record<string, Prompt>>>
