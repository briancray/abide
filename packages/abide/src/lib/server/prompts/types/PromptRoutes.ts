import type { Prompt } from './Prompt.ts'

/*
Manifest of prompt-name → module loader. Produced by the resolver plugin
from each `.md` under src/mcp/prompts/. Each markdown file is transformed
into a module that registers one Prompt (its `.name` stamped in by the
generated definePrompt call) on import. The registry loader imports every
module once so the MCP dispatcher can enumerate the full prompt surface.
*/
export type PromptRoutes = Record<string, () => Promise<Record<string, Prompt>>>
