import { rpcRegistry } from './rpcRegistry.ts'
import type { RpcRegistryEntry } from './types/RpcRegistryEntry.ts'

export function registerRpc(entry: RpcRegistryEntry): void {
    rpcRegistry.set(entry.remote.url, entry)
}
