/* The active hydration pass's consumed-seed marks (ADR-0048 two-phase consume): each seed a
   pass adopts is MARKED here rather than deleted, so a THROWING pass leaves every value in
   place for the cold rebuild to re-adopt (no shadow backup), while a clean pass exit deletes
   the marked keys — preserving the one-shot contract (an SPA re-nav to the same render-path
   re-inits fresh). Owned by `runHydrationPass` (save/restore for nesting); undefined outside
   a pass, where `consumeSeed` falls back to delete-on-read. Deliberately NOT cleared by
   `withoutHydration` — a fresh build inside a live pass (a block's cold rebuild) still marks,
   so an outer-pass throw can still hand its seeds to the recovery rebuild. */
export const SEED_MARKS: {
    current: { store: Record<string, string>; key: string }[] | undefined
} = { current: undefined }
