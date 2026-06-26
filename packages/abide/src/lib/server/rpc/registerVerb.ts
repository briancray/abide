import { rpcRegistry } from './rpcRegistry.ts'
import type { VerbRegistryEntry } from './types/VerbRegistryEntry.ts'

export function registerVerb(entry: VerbRegistryEntry): void {
    rpcRegistry.set(entry.remote.url, entry)
}
