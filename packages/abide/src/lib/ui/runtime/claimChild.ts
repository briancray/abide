import type { HydrationCursor } from './types/HydrationCursor.ts'

/* The next server-rendered node to claim under `parent` during hydration — a PROBE
   (the cursor doesn't move), defaulting to the first child when the pointer hasn't
   been set yet. The claim verbs read through this and advance via `parkCursor`. */
export function claimChild(hydration: HydrationCursor, parent: Node): Node | null {
    return hydration.next.has(parent) ? (hydration.next.get(parent) ?? null) : parent.firstChild
}
