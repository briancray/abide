/*
Wraps a `{...source}` spread layer so every key resolves to a live value thunk —
the same `() => value` shape an explicit `name={expr}` prop compiles to, so a child
reads a spread key exactly like an authored one (`$props[key]?.()`). `source` is a
THUNK over the spread expression (not its value), re-evaluated on each key read and
membership test, so a reactive source stays live both when its keys mutate and when
the whole object is replaced — and the read registers as the reader's dependency. A
nullish source spreads nothing. The reserved `$children` slot key is never surfaced —
a source happening to carry one must not masquerade as slot content.
*/
// @documentation plumbing
export function spreadProps(
    source: () => Record<string, unknown> | null | undefined,
): Record<string, () => unknown> {
    /* A spread key the merged bag exposes — present on the current source and not the
       reserved `$children` slot key (a source carrying one must not become slot content). */
    const carries = (key: string | symbol): boolean =>
        key !== '$children' && key in (source() ?? {})
    return new Proxy(
        {},
        {
            /* Each read returns a fresh thunk that re-evaluates the source for the key. */
            get: (_target, key) => () => source()?.[key as string],
            /* Live membership: whether the current source object carries the key. */
            has: (_target, key) => carries(key),
            /* Enumerable over the current source, so a merged bag reports spread keys. */
            ownKeys: () => Reflect.ownKeys(source() ?? {}).filter(carries),
            getOwnPropertyDescriptor: (_target, key) =>
                carries(key) ? { enumerable: true, configurable: true } : undefined,
        },
    ) as Record<string, () => unknown>
}
