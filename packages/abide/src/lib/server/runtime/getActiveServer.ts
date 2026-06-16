import type { Server } from 'bun'
import { serverSlot } from './serverSlot.ts'

export function getActiveServer(): Server<unknown> | undefined {
    return serverSlot.active
}
