// 56.24-56.28 — A VALUE EDITED WHERE IT STANDS: shown as text that a press or Enter turns into a field,
// Enter or leaving saving it and Escape putting it back, as parts an app spreads onto a button and an
// input of its own. While a save is in flight the field waits, disabled; a save that fails keeps it
// open with the failure's message, as a prompt's `run` does (50.45).

import { messageOf } from './messageOf.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { isThenable } from './reactive/isThenable.ts'

/** The value, and what saves an edit of it. */
export type InlineEditOptions = {
    /** The value shown and edited: a `Reactive` to read and write it. Held by the parts, and handed back as `value`, where none is given. */
    value?: Reactive<string> | undefined
    /** Saves the text an edit ends with, before `value` takes it; a promise it hands back is waited on, and its rejection keeps the field open. */
    save?: ((text: string) => unknown) | undefined
}

/** The parts `inlineEdit` hands back: `<button {...name.view}>`, `<input {...name.input}>`. */
export type InlineEdit = {
    /** The text shown while not editing: a button that starts an edit. */
    readonly view: Record<string, unknown>
    /** The field shown while editing. */
    readonly input: Record<string, unknown>
    /** Whether it is being edited; written, it starts or ends one without saving. */
    readonly editing: Reactive<boolean>
    /** The value — the `value` it was handed, or one of its own. */
    readonly value: Reactive<string>
    /** Whether a save is in flight. */
    get busy(): boolean
    /** The message of the save that failed last, while the edit it failed stays open. */
    get error(): string | undefined
}

/** A value shown as a button that turns into a field, saving on Enter and leaving, undone by Escape. */
export function inlineEdit(options: InlineEditOptions = {}): InlineEdit {
    const value = options.value ?? reactive('')
    const editing = reactive(false)
    const busy = reactive(false)
    const error = reactive<string | undefined>(undefined)
    let view: HTMLElement | undefined

    // 56.27 — focus goes back to what started the edit, once the button stands again.
    const finish = (): void => {
        editing.set(false)
        error.set(undefined)
        queueMicrotask(() => view?.focus())
    }
    // 56.25, 56.26
    const commit = async (text: string): Promise<void> => {
        if (busy.peek() || !editing.peek()) return
        if (text === value.peek()) return finish()
        busy.set(true)
        try {
            const saved = options.save?.(text)
            if (isThenable(saved)) await saved
            value.set(text)
            finish()
        } catch (failure) {
            error.set(messageOf(failure))
        } finally {
            busy.set(false)
        }
    }

    return {
        // 56.24
        view: {
            type: 'button',
            'data-inline-edit': 'view',
            get hidden() {
                return editing()
            },
            onclick: () => {
                error.set(undefined)
                editing.set(true)
            },
            'bind:element': (element: HTMLElement) => {
                view = element
                return () => {
                    if (view === element) view = undefined
                }
            },
        },
        input: {
            'data-inline-edit': 'input',
            get hidden() {
                return !editing()
            },
            get disabled() {
                return busy()
            },
            get 'aria-busy'() {
                return busy() ? 'true' : undefined
            },
            get 'aria-invalid'() {
                return error() === undefined ? undefined : 'true'
            },
            get value() {
                return value()
            },
            'bind:element': (element: HTMLInputElement) => {
                // 56.24 — the field starts from the value, selected, each time an edit begins. The
                // spread writes the property only where the value moved (32.113), and Escape leaves
                // what was typed in a field whose value never did.
                const started = (): void => {
                    if (!editing.peek()) return
                    const text = value.peek() ?? ''
                    if (element.value !== text) element.value = text
                    element.focus()
                    element.select()
                }
                const stop = editing.watch(() => queueMicrotask(started))
                return stop
            },
            onkeydown: (event: KeyboardEvent) => {
                if (event.key === 'Enter') {
                    event.preventDefault()
                    void commit((event.currentTarget as HTMLInputElement).value)
                } else if (event.key === 'Escape') {
                    // 56.27
                    event.preventDefault()
                    finish()
                }
            },
            onblur: (event: FocusEvent) => {
                if (!busy.peek() && error.peek() === undefined)
                    void commit((event.currentTarget as HTMLInputElement).value)
            },
        },
        editing,
        value,
        get busy() {
            return busy()
        },
        get error() {
            return error()
        },
    }
}
