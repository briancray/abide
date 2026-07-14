import type { CacheSelector } from './CacheSelector.ts'

/*
The side-swappable applier stored in amendBroadcastSlot (ADR-0043). Given a selector,
its args, whether the payload is a concrete value (vs. an updater closure), and the
payload itself, either apply it to this side's store (client / fallback) or broadcast
the keyed value to every authorized reader (server). Only the value form is
broadcastable; the server resolver throws on an updater (a closure has no wire form).
*/
export type AmendApply = <Args, Return>(
    selector: CacheSelector<Args, Return>,
    args: Args | undefined,
    isValue: boolean,
    payload: Return | ((current: Return) => Return),
) => void
