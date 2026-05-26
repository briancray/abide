import type { SocketRegistryEntry } from './types/SocketRegistryEntry.ts'
import { socketRegistry } from './socketRegistry.ts'

export function registerSocket(entry: SocketRegistryEntry): void {
    socketRegistry.set(entry.socket.name, entry)
}
