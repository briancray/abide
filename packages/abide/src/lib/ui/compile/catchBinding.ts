import type { Binding } from './types/Binding.ts'

/* A block's `catch` branch binding — the error name, or none when the block has no catch
   branch. Shared by the await/each/try plans so the one catch-binding shape stays
   single-source. `reactive` binds the error as a `.value` cell the runtime can update in
   place (the reactive `{#try}` — a catch→catch error swaps in place, no rebuild); the
   await/each catches leave it `plain` (they pass the error by value). */
export function catchBinding(catchAs: string, hasCatch: boolean, reactive = false): Binding[] {
    return hasCatch ? [{ name: catchAs, classification: reactive ? 'reactive' : 'plain' }] : []
}
