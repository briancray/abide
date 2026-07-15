/* The active hydration pass's claim cursor: per parent, the next server-rendered child
   to claim — a node pointer (not an index) so it survives nodes a block inserts (anchors,
   range brackets) mid-hydration. Read through `claimChild` (probe) / the claim verbs
   (claim + advance); repositioned through `parkCursor`. The live instance hangs off
   `RENDER.hydration` (undefined outside a pass). */
export type HydrationCursor = {
    next: Map<Node, Node | null>
}
