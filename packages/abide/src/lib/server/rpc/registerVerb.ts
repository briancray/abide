import type { VerbRegistryEntry } from './types/VerbRegistryEntry.ts'
import { verbRegistry } from './verbRegistry.ts'

export function registerVerb(entry: VerbRegistryEntry): void {
    verbRegistry.set(entry.remote.url, entry)
}
