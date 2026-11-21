// 51.72-51.78 — A MODAL SEARCH OVER WHAT AN APP CAN DO: WAI-ARIA's combobox inside a modal dialog, as
// parts an app spreads onto elements of its own. The dialog is the app's `Dialog`, its `open` the one
// handed here, so the page behind it is inert, Escape cancels it and closing it hands focus back to
// what had it; the keys over the list are `listbox`'s, and the key that opens it is a `hotkeys` binding
// on the window, listened to for as long as the setup that made the parts stands.

import { checkParts } from './checkParts.ts'
import { hotkeys } from './hotkeys.ts'
import { listbox } from './listbox.ts'
import { randomToken } from './randomToken.ts'
import { type Reactive, reactive, watch } from './reactive/index.ts'

/** One thing the palette can do. */
export type Command = {
    /** What the command is called: what it lists as, and what typing matches. */
    label: string
    /** Further words typing matches: `['add', 'create']` beside `'New deal'`. */
    keywords?: readonly string[]
    /** The binding the app runs the command on elsewhere, which the palette shows and does not bind. */
    key?: string
    /** What choosing the command does, once the palette has shut. */
    run: () => void
}

/** What the palette lists, what opens it, and what it is called. */
export type CommandPaletteOptions = {
    /** What the palette can do, in the order it lists them, each told apart by its `label`; a function is read live. */
    commands: readonly Command[] | (() => readonly Command[])
    /** Whether the palette is showing: hand it the `Reactive` the app's `Dialog` binds as `open`. */
    open?: Reactive<boolean>
    /** The binding that opens and shuts it, as `hotkeys` reads one. `'mod+k'` by default. */
    hotkey?: string
    /** The base the input's, the list's and each option's ids are derived from; unique on the page. */
    id?: string
    /** The palette's accessible name. `'Commands'` by default. */
    label?: string
}

/** The parts `commandPalette` hands back, each spread onto an element: `<input {...palette.input} />`. */
export type CommandPaletteParts = {
    /** The dialog's accessible name, for the app's `Dialog`. */
    readonly dialog: Record<string, unknown>
    /** The search input: a combobox naming the active command, and its typing and keys. */
    readonly input: Record<string, unknown>
    /** The list of commands listed. */
    readonly listbox: Record<string, unknown>
    /** A command's option: its id, whether it is active, and its click. */
    option(command: Command): Record<string, unknown>
    /** What shows where nothing typed matches a command: a status a screen reader reads. */
    readonly empty: Record<string, unknown>
    /** The commands listed for what is typed, in the order given. */
    results(): readonly Command[]
    /** Whether the palette is showing: the `open` handed in, or one of the palette's own. */
    readonly open: Reactive<boolean>
}

/** WAI-ARIA's combobox in a modal dialog, over the commands an app can run, as parts to spread. */
export function commandPalette(
    options: CommandPaletteOptions,
): CommandPaletteParts {
    const {
        commands,
        hotkey = 'mod+k',
        id = `palette-${randomToken(4, 'hex')}`,
        label = 'Commands',
    } = options
    const open = options.open ?? reactive(false)
    const commandsOf =
        typeof commands === 'function' ? commands : () => commands
    const inputId = `${id}-input`
    const listId = `${id}-listbox`
    if (process.env.NODE_ENV !== 'production')
        checkParts('commandPalette', `${id}-`)

    const query = reactive('')

    // 51.73 — a command is listed while every word typed is in its label or one of its keywords.
    const found = reactive(() => {
        const words = query().toLowerCase().split(/\s+/)
        const kept: Command[] = []
        for (const command of commandsOf()) {
            let text = command.label.toLowerCase()
            for (const keyword of command.keywords ?? [])
                text += ` ${keyword.toLowerCase()}`
            if (words.every((word) => text.includes(word))) kept.push(command)
        }
        return kept
    })

    // 51.75 — shut first, so focus is back where it was before the command moves it.
    const run = (command: Command): void => {
        open.set(false)
        command.run()
    }

    const list = listbox({
        id,
        options: () => found(),
        key: (command) => command.label,
        onpick: run,
    })

    // 51.72 — the binding toggles, so the key that opened the palette shuts it from inside its input.
    const keys = hotkeys({
        [hotkey]: { run: () => open.set(!open.peek()), editable: true },
    })
    watch(() => {
        if (typeof window === 'undefined') return
        window.addEventListener('keydown', keys)
        return () => window.removeEventListener('keydown', keys)
    })

    // 51.78 — every command is listed again, the input emptied, each time the palette opens: the field's
    // own value too, which no attribute written to it would change once something was typed in it.
    watch(() => {
        if (!open()) return
        query.set('')
        const field = globalThis.document?.getElementById(inputId)
        if (field instanceof HTMLInputElement) field.value = ''
    })

    return {
        dialog: { 'aria-label': label },
        input: {
            id: inputId,
            type: 'text',
            role: 'combobox',
            autocomplete: 'off',
            autofocus: true,
            'aria-label': label,
            'aria-autocomplete': 'list',
            'aria-expanded': 'true',
            'aria-controls': listId,
            get 'aria-activedescendant'() {
                return list.activeId()
            },
            oninput: (event: Event) =>
                query.set((event.currentTarget as HTMLInputElement).value),
            // 51.76 — Escape is the dialog's to cancel, and Home and End move the caret in the text.
            onkeydown: (event: KeyboardEvent) => {
                if (
                    event.key === 'Escape' ||
                    event.key === 'Home' ||
                    event.key === 'End'
                )
                    return
                list.keydown(event)
            },
        },
        listbox: {
            id: listId,
            role: 'listbox',
            'aria-label': label,
            onmousedown: (event: MouseEvent) => event.preventDefault(),
        },
        option: (command) => ({
            id: list.idOf(command.label),
            role: 'option',
            get 'aria-selected'() {
                return list.active() === command.label ? 'true' : 'false'
            },
            get 'data-active'() {
                return list.active() === command.label ? '' : undefined
            },
            onpointermove: () => list.activate(command.label),
            onclick: () => run(command),
        }),
        empty: { role: 'status' },
        results: () => found(),
        open,
    }
}
