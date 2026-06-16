import { baseSlot } from './baseSlot.ts'

// Registers the runtime's mount-base resolver. Called once per side at boot.
export function setBaseResolver(fn: () => string): void {
    baseSlot.resolver = fn
}
