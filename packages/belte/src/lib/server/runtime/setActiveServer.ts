import type { Server } from 'bun'
import { serverSlot } from './serverSlot.ts'

export function setActiveServer(server: Server<unknown>): void {
    serverSlot.active = server
}
