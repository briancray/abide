import type { UiProps } from '../runtime/types/UiProps.ts'

/*
Composes a child's props from ordered layers — explicit prop runs (`{ name: () =>
value }` thunk maps), `{...spread}` layers (`spreadProps`), and a trailing slot
layer (`children`) — into one prop bag, last layer wins per key (source order, like
JSX). A key resolves by scanning layers in reverse for the first that carries it, so
an explicit prop after a spread overrides it and vice-versa. Emitted only when a
component carries a spread; the plain object literal stays the path otherwise.
*/
// @documentation plumbing
export function mergeProps(layers: Record<string | symbol, unknown>[]): UiProps {
    return new Proxy(Object.create(null), {
        get(_target, key) {
            for (let index = layers.length - 1; index >= 0; index -= 1) {
                const layer = layers[index]
                if (layer !== undefined && key in layer) {
                    return layer[key]
                }
            }
            return undefined
        },
        has: (_target, key) => layers.some((layer) => key in layer),
        /* Enumerable across every layer (deduped), so `restProps` can collect a
           parent-spread bag's keys. */
        ownKeys: () => [...new Set(layers.flatMap((layer) => Reflect.ownKeys(layer)))],
        getOwnPropertyDescriptor: (_target, key) =>
            layers.some((layer) => key in layer)
                ? { enumerable: true, configurable: true }
                : undefined,
    }) as UiProps
}
