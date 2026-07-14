import { cache } from './cache.ts'
import type { CacheSelector } from './types/CacheSelector.ts'

/*
Applies an amend to THIS side's cache store(s) — the local half of the isomorphic
amend value form (ADR-0043). A concrete value folds to an updater that ignores the
current value; an updater is used as-is. Both the amendBroadcastSlot fallback and the
client entry's resolver point here so the local-apply path can't diverge between an
unbooted unit test and a booted client tab. The server entry installs a broadcaster
instead (the side-swap seam), so this never runs on the server's throwaway request store.
*/
export function applyAmendLocally<Args, Return>(
    selector: CacheSelector<Args, Return>,
    args: Args | undefined,
    isValue: boolean,
    payload: Return | ((current: Return) => Return),
): void {
    const updater = isValue ? () => payload as Return : (payload as (current: Return) => Return)
    cache.amend(selector, args, updater, isValue)
}
