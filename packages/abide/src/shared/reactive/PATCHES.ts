// 32.34 — WHICH OBJECTS AN `s.patch` WROTE TO, and when. `epoch` moves once per patch and `written`
// holds the epoch an object was last written at, so a row made at epoch `e` is stale exactly where
// its item's entry is past `e`. A leaf, because `reconcile` reads it from the `abide/runtime` barrel.
export const PATCHES: { epoch: number; written: WeakMap<object, number> } = {
    epoch: 0,
    written: new WeakMap(),
}
