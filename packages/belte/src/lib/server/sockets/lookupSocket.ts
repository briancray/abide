import type { SocketRegistryEntry } from './types/SocketRegistryEntry.ts'
import { socketRegistry } from './socketRegistry.ts'

export function lookupSocket(name: string): SocketRegistryEntry | undefined {
    return socketRegistry.get(name)
}
