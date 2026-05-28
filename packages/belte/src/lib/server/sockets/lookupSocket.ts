import { socketRegistry } from './socketRegistry.ts'
import type { SocketRegistryEntry } from './types/SocketRegistryEntry.ts'

export function lookupSocket(name: string): SocketRegistryEntry | undefined {
    return socketRegistry.get(name)
}
