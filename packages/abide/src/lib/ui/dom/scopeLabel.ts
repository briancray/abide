/*
The human-readable name for the scope the direct-mount entry (`mount`/`hydrate`)
establishes, derived from its host element's tag. The router instead fills layers into
marker boundaries with no host element, so it passes each layer's route key as an
explicit label (`fillBoundary`); a nested child likewise passes its component name (see
`mountRange`). The `abide-` prefix strip turns a framework host tag like `abide-resolve`
into `resolve`; any other host yields its lowercased tag. Feeds the inspector's
Reactive tab a readable scope name; computed and stored in all builds (only the
inspector surface is dev-only). Returns undefined when there's no element to name from.
*/
import { COMPONENT_WRAPPER_PREFIX } from '../COMPONENT_WRAPPER_PREFIX.ts'

export function scopeLabel(host: Element): string | undefined {
    const tag = host.tagName?.toLowerCase()
    if (tag === undefined) {
        return undefined
    }
    return tag.startsWith(COMPONENT_WRAPPER_PREFIX)
        ? tag.slice(COMPONENT_WRAPPER_PREFIX.length)
        : tag
}
