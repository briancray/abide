/*
The human-readable name for the scope a mount/hydrate establishes, derived from
its host element's tag. A nested component mounts into its `abide-<name>` wrapper
(see `componentWrapperTag`), so stripping the `abide-` prefix recovers the
component name; any other host (a page/layout outlet) yields its lowercased tag.
Dev-only — feeds the inspector's Reactive tab so a scope reads `<Counter>` rather
than an opaque counter id. Returns undefined when there's no element to name from.
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
