/* The active hydration pass's consumed-seed marks (ADR-0048 two-phase consume): each seed a
   pass adopts is MARKED here rather than deleted, so a THROWING pass leaves every value in
   place for the cold rebuild to re-adopt (no shadow backup), while the OUTERMOST clean pass
   exit deletes the marked keys — preserving the one-shot contract (an SPA re-nav to the same
   render-path re-inits fresh). Keyed per store so a mark is an O(1) Set add on the hydrate
   hot path. Owned by `runHydrationPass`: save/restore for nesting, and a nested clean exit
   hands its marks to the enclosing pass instead of committing — only the outermost owner
   spends seeds, so an outer-pass throw can still hand every value to the recovery rebuild.
   undefined outside a pass, where `consumeSeed` falls back to delete-on-read. Deliberately
   NOT cleared by `withoutHydration` — a fresh build inside a live pass (a block's cold
   rebuild) still marks and re-adopts. */
export const SEED_MARKS: {
    current: Map<Record<string, string>, Set<string>> | undefined
} = { current: undefined }
