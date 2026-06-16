import { promptRegistry } from './promptRegistry.ts'
import type { PromptRegistryEntry } from './types/PromptRegistryEntry.ts'

export function registerPrompt(entry: PromptRegistryEntry): void {
    promptRegistry.set(entry.prompt.name, entry)
}
