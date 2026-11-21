// 50.1-50.4 — A NATIVE MODAL, as parts an app spreads onto a `<dialog>` of its own: the browser puts a
// `showModal` dialog in the top layer, makes the page behind it inert, keeps focus inside it and fires
// `cancel` on Escape, so none of that is code here. What is: `open` shown and closed both ways, Escape
// and the backdrop held back where it is not `dismissible`, and the `[autofocus]` that renders with the
// opening focused. `modal: false` is `show`, which does none of the browser's part: the page stays
// usable around the dialog.

import { type Live, live } from './live.ts'
import { type Reactive, watch } from './reactive/index.ts'

/** Whether the dialog shows, and how it opens and closes. */
export type DialogOptions = {
    /** Whether the dialog is showing: every way it closes writes `false` to it. */
    open: Reactive<boolean>
    /** Whether it opens modal, over an inert page, or beside the page with `show`. `true` by default. */
    modal?: Live<boolean>
    /** Whether Escape and a click on the backdrop close it. `true` by default. */
    dismissible?: Live<boolean>
    /** Called each time it closes, however it closed, with the `<dialog>`'s `returnValue`. */
    onclose?: (returnValue: string) => void
}

/** The part `dialog` hands back: `<dialog {...edit.dialog}>`. */
export type DialogParts = {
    /** The `<dialog>`'s opening and closing, its dismissal and `data-open`. */
    readonly dialog: Record<string, unknown>
}

/** A native `<dialog>` opened and closed by `open`, as a part to spread. */
export function dialog(options: DialogOptions): DialogParts {
    const { open, onclose } = options
    const modal = () => live(options.modal ?? true)
    const dismissible = () => live(options.dismissible ?? true)

    return {
        dialog: {
            get 'data-open'() {
                return open() ? '' : undefined
            },
            'bind:element': (element: HTMLDialogElement) =>
                watch(() => {
                    const showing = open()
                    if (element.open === showing) return
                    if (!showing) return element.close()
                    element.returnValue = ''
                    if (modal()) element.showModal()
                    else element.show()
                    // What renders with the opening lands after `showModal`'s own focusing ran (50.4).
                    queueMicrotask(() =>
                        element
                            .querySelector<HTMLElement>('[autofocus]')
                            ?.focus(),
                    )
                }),
            // `open` is written before `onclose` runs, so a caller reopening from it is not undone (50.2).
            // A `close` event is queued as a task, so one a close made in code fires after whatever ran
            // next: where that reopened the dialog, the close it reports is already over and `open`
            // stays as it is.
            onclose: (event: Event) => {
                const element = event.currentTarget as HTMLDialogElement
                if (!element.open) open.set(false)
                onclose?.(element.returnValue)
            },
            oncancel: (event: Event) => {
                if (!dismissible()) event.preventDefault()
            },
            // A click on the dialog itself, outside its box, is a click on the backdrop (50.3).
            onclick: (event: MouseEvent) => {
                const element = event.currentTarget as HTMLDialogElement
                if (!dismissible() || event.target !== element) return
                const box = element.getBoundingClientRect()
                if (
                    event.clientX < box.left ||
                    event.clientX > box.right ||
                    event.clientY < box.top ||
                    event.clientY > box.bottom
                )
                    element.close()
            },
        },
    }
}
