import { rpcRegistry } from './rpcRegistry.ts'
import type { VerbRegistryEntry } from './types/VerbRegistryEntry.ts'

export function registerRpc(entry: VerbRegistryEntry): void {
    rpcRegistry.set(entry.remote.url, entry)
}
