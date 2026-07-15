import type { HydrationCursor } from './types/HydrationCursor.ts'

/* Repositions the parent's claim cursor at `reference` (null = past the last child). The
   ONE write site of the cursor invariant: every claim must leave the cursor on the next
   unclaimed sibling, or the following claim grabs the wrong node — a silent desync. The
   claim verbs advance through here; a block parks explicitly when it skips or discards a
   region (an anchor's content, a boundary it re-claims later, a discarded range). */
export function parkCursor(hydration: HydrationCursor, parent: Node, reference: Node | null): void {
    hydration.next.set(parent, reference)
}
