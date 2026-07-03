import { whenIdle } from './whenIdle.ts'
import { whenVisible } from './whenVisible.ts'

/*
Schedule a one-shot wake for a deferred (inert-hydrated) region by trigger — the single
trigger-selection both the await block and component islands share. `'visible'` (and `'auto'`)
wake on scroll-in when the DOM can be measured (a real IntersectionObserver) and the region has
an element to observe: a below-the-fold region decodes only when reached, one never scrolled to
costs nothing. Otherwise — `'idle'`, no observer, or an empty branch — wake on idle: off the
critical boot path but soon, so the region never lingers inert. Returns a cancel to drop a
pending wake on teardown.

`'auto'` is the await block's policy (defer decides, position decides trigger); `'idle'` /
`'visible'` are an island's explicit `client:` choice.
*/
export function scheduleWake(
    trigger: 'idle' | 'visible' | 'auto',
    element: Element | undefined,
    wake: () => void,
): () => void {
    const hasObserver =
        typeof (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ===
        'function'
    if (trigger !== 'idle' && hasObserver && element !== undefined) {
        return whenVisible(element, wake)
    }
    return whenIdle(wake)
}
