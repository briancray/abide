import type { Disposer } from '#shared/reactive/watch.ts'

/** A part's element binding, handed `element` as a spread of the part hands it (32.99). */
export function bindPart(
    part: Record<string, unknown>,
    element: Element,
): Disposer {
    const bind = part['bind:element'] as (
        element: Element,
    ) => Disposer | undefined
    return bind(element) ?? (() => {})
}
