import type { SocketRegistryEntry } from './types/SocketRegistryEntry.ts'

/*
Process-wide registry of every Socket declared in the app. defineSocket
inserts on first construction; the dispatcher reads on every `sub` /
`pub` frame so it can find the right Socket by name and check the
opted-in `allowClientPublish` policy.
*/
export const socketRegistry = new Map<string, SocketRegistryEntry>()
