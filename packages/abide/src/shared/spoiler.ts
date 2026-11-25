// 51.152-51.155 — WHAT STAYS COVERED UNTIL SOMEONE ASKS FOR IT: a cover of the app's own in the place of
// its content, and pressing the cover puts the content there. Unlike a `disclosure`'s region, the
// content is hidden outright while covered, so neither find in page nor a screen reader reaches it.

import { type Reactive, reactive } from './reactive/index.ts'

/** Whether the content shows. */
export type SpoilerOptions = {
    /** Whether the content shows: hand it a `Reactive` to read and write it. Held by the parts, and handed back as `open`, where none is given. */
    open?: Reactive<boolean> | undefined
}

/** The parts `spoiler` hands back: `<button {...secret.cover}>`, `<span {...secret.content}>`. */
export type Spoiler = {
    /** The cover's attributes and its click: shown while the content is covered. */
    readonly cover: Record<string, unknown>
    /** The content's attributes: hidden while it is covered. */
    readonly content: Record<string, unknown>
    /** Whether the content shows — the `open` it was handed, or one of its own. */
    readonly open: Reactive<boolean>
}

/** A cover standing in for content until it is pressed, as parts to spread. */
export function spoiler(options: SpoilerOptions = {}): Spoiler {
    const open = options.open ?? reactive(false)
    let content: HTMLElement | undefined
    return {
        // 51.152, 51.154
        cover: {
            type: 'button',
            'data-spoiler': 'cover',
            get hidden() {
                return open()
            },
            onclick: () => {
                // 49.19 — refused, the cover stays and keeps focus.
                if (open.set(true) !== undefined) return
                // The pressed cover is hidden by the write, and focus would drop to the page.
                queueMicrotask(() => content?.focus())
            },
        },
        content: {
            'data-spoiler': 'content',
            // 51.153
            get hidden() {
                return !open()
            },
            // 51.155
            get 'data-open'() {
                return open() ? '' : undefined
            },
            tabindex: '-1',
            'bind:element': (element: HTMLElement) => {
                content = element
                return () => {
                    if (content === element) content = undefined
                }
            },
        },
        open,
    }
}
