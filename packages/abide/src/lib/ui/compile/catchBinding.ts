import type { Binding } from './types/Binding.ts'

/* A block's `catch` branch binding — the error name bound `plain`, or none when the block
   has no catch branch. Shared by the await/each/try plans so the one catch-binding shape
   stays single-source. */
export function catchBinding(catchAs: string, hasCatch: boolean): Binding[] {
    return hasCatch ? [{ name: catchAs, classification: 'plain' }] : []
}
