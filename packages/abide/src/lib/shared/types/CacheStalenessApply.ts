import type { CacheSelector } from './CacheSelector.ts'

/*
The side-swappable staleness applier stored in cacheStalenessSlot (ADR-0041): given
a verb and a (non-async-cell) selector, either apply it locally (client / fallback)
or broadcast it (server). The async-cell short-circuit is handled in invalidate() /
refresh() before the slot, so this only ever sees a real CacheSelector.
*/
export type CacheStalenessApply = <Args, Return>(
    op: 'invalidate' | 'refresh',
    selector: CacheSelector<Args, Return>,
    args?: Args,
) => void
