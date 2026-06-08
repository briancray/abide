import { pageSlot } from './pageSlot.ts'
import type { PageSnapshot } from './types/PageSnapshot.ts'

// Registers the runtime's page resolver. Called once per side at boot.
export function setPageResolver(fn: () => PageSnapshot | undefined): void {
    pageSlot.resolver = fn
}
