/**
 * Which objects an `s.patch` wrote to, and when.
 *
 * 32.34. `epoch` moves once per patch and `written` holds the epoch an object was last written at,
 * so a row made at epoch `e` is stale exactly where its item's entry is past `e`. A leaf, because
 * `reconcile` reads it from the `abide/runtime` barrel.
 */
export const PATCHES: { epoch: number; written: WeakMap<object, number> } = {
    epoch: 0,
    written: new WeakMap(),
}
