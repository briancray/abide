import { RESERVED_SOCKET_PREFIX } from '../../shared/RESERVED_SOCKET_PREFIX.ts'
import { socketRegistry } from './socketRegistry.ts'
import type { SocketRegistryEntry } from './types/SocketRegistryEntry.ts'

export function registerSocket(entry: SocketRegistryEntry): void {
    /* A reserved (__abide/) topic is framework-internal and server-publish-only. Enforce
       that invariant at the one chokepoint every socket flows through: a reserved name can
       never register with client publish enabled, so no later trusted-but-mistaken
       defineSocket call can turn an internal topic into one a browser could forge frames on
       (ADR-0041). The framework mints its reserved topics clientPublish:false, so this never
       fires on the legitimate path; the boot scan separately rejects reserved user files. */
    if (entry.socket.name.startsWith(RESERVED_SOCKET_PREFIX) && entry.allowClientPublish) {
        throw new Error(
            `[abide] socket "${entry.socket.name}" is reserved — the "${RESERVED_SOCKET_PREFIX}" namespace is framework-internal and cannot enable clientPublish.`,
        )
    }
    socketRegistry.set(entry.socket.name, entry)
}
