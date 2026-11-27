// 50.1-50.4 — A NATIVE MODAL, as parts an app spreads onto a `<dialog>` of its own: the browser puts a
// `showModal` dialog in the top layer, makes the page behind it inert, keeps focus inside it and fires
// `cancel` on Escape, so none of that is code here. What is: `open` shown and closed both ways, Escape
// and the backdrop held back where it is not `dismissible`, and the `[autofocus]` that renders with the
// opening focused. A dialog filling the viewport has no backdrop outside its box to click, so the
// `backdrop` part names an element of the app's own that stands for it. `modal: false` is `show`, which does none of the browser's part: the page stays
// usable around the dialog.

import { type Live, live } from './live.ts'
import { type Reactive, reactive, watch } from './reactive/index.ts'

/** Whether the dialog shows, and how it opens and closes. */
export type DialogOptions = {
    /** Whether the dialog is showing: hand it a `Reactive` to read and write it, and every way it closes writes `false` back. One of the dialog's own by default. */
    open?: Reactive<boolean> | undefined
    /** Whether it opens modal, over an inert page, or beside the page with `show`. `true` by default. */
    modal?: Live<boolean> | undefined
    /** Whether Escape and a click on the backdrop, or on the element `backdrop` is spread on, close it. `true` by default. */
    dismissible?: Live<boolean> | undefined
    /** Called each time it closes, however it closed, with the `<dialog>`'s `returnValue`. */
    onclose?: ((returnValue: string) => void) | undefined
}

/** The parts `dialog` hands back, `<dialog {...edit.dialog}>`, and whether it is showing. */
export type DialogParts = {
    /** The `<dialog>`'s opening and closing, its dismissal and `data-open`. */
    readonly dialog: Record<string, unknown>
    /** An element inside the `<dialog>` standing for its backdrop: a click on it, and not on what it holds, dismisses the dialog. */
    readonly backdrop: Record<string, unknown>
    /** Whether the dialog is showing — the `open` it was handed, or one of its own. */
    readonly open: Reactive<boolean>
}

/** A native `<dialog>` opened and closed by `open`, as a part to spread. */
export function dialog(options: DialogOptions = {}): DialogParts {
    const open = options.open ?? reactive(false)
    const modal = () => live(options.modal) ?? true
    const dismissible = () => live(options.dismissible) ?? true
    const show = (element: HTMLDialogElement): void => {
        if (modal()) element.showModal()
        else element.show()
    }

    return {
        open,
        // 50.3 — the click's target is the element itself, so a click on what it holds closes nothing.
        backdrop: {
            'data-dialog': 'backdrop',
            onclick: (event: MouseEvent) => {
                if (dismissible() && event.target === event.currentTarget)
                    open.set(false)
            },
        },
        dialog: {
            'data-dialog': 'dialog',
            get 'data-open'() {
                return open() ? '' : undefined
            },
            'bind:element': (element: HTMLDialogElement) =>
                watch(() => {
                    const showing = open()
                    if (element.open === showing) return
                    if (!showing) return element.close()
                    element.returnValue = ''
                    show(element)
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
            // 49.19 — a close the element made itself that `open` refuses shows it again, unreported.
            onclose: (event: Event) => {
                const element = event.currentTarget as HTMLDialogElement
                if (
                    !element.open &&
                    open.peek() &&
                    open.set(false) !== undefined
                )
                    return show(element)
                options.onclose?.(element.returnValue)
            },
            // An Escape `open` refuses is held back before the element closes.
            oncancel: (event: Event) => {
                if (!dismissible() || open.set(false) !== undefined)
                    event.preventDefault()
            },
            // 50.3 — `show` fires no `cancel`, so a dialog beside the page hears Escape itself, from
            // focus inside it: the page around it is still the visitor's, and its Escape is theirs.
            onkeydown: (event: KeyboardEvent) => {
                if (event.key !== 'Escape' || modal() || event.defaultPrevented)
                    return
                event.preventDefault()
                if (dismissible()) open.set(false)
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
                    open.set(false)
            },
        },
    }
}
