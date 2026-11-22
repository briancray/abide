// 51.72-51.78 — A MODAL SEARCH OVER WHAT AN APP CAN DO: WAI-ARIA's combobox inside a modal dialog, as
// parts an app spreads onto elements of its own. The dialog is `dialog`'s parts on the app's own
// `<dialog>`, opened modal by the `open` handed here, so the page behind it is inert, Escape cancels it
// and closing it hands focus back to what had it; the keys over the list are `listbox`'s, and the key that opens it is a `hotkeys` binding
// on the window, listened to for as long as the setup that made the parts stands.

import { checkParts } from './checkParts.ts'
import { dialog } from './dialog.ts'
import { hotkeys } from './hotkeys.ts'
import { listbox } from './listbox.ts'
import { type Live, live } from './live.ts'
import { randomToken } from './randomToken.ts'
import { type Reactive, reactive, watch } from './reactive/index.ts'
import { withPart } from './withPart.ts'

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
    commands: Live<readonly Command[]>
    /** Whether the palette is showing: a `Reactive` to open it from a button of the app's own. One of the palette's own by default. */
    open?: Reactive<boolean>
    /** The binding that opens and shuts it, as `hotkeys` reads one. `'mod+k'` by default. */
    hotkey?: Live<string>
    /** The base the input's, the list's and each option's ids are derived from; unique on the page. */
    id?: string
    /** The palette's accessible name. `'Commands'` by default. */
    label?: Live<string>
}

/** One command's parts: its option, and the label and the key written in it. */
export type CommandParts = {
    /** The option: its id, whether it is active, and its click. */
    readonly option: Record<string, unknown>
    /** The element holding the command's label. */
    readonly label: Record<string, unknown>
    /** The element showing the command's key. */
    readonly key: Record<string, unknown>
}

/** The parts `commandPalette` hands back, each spread onto an element: `<input {...palette.input} />`. */
export type CommandPaletteParts = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** The `<dialog>`: `dialog`'s part, opened modal by `open`, and the palette's accessible name. */
    readonly dialog: Record<string, unknown>
    /** The search input: a combobox naming the active command, and its typing and keys. */
    readonly input: Record<string, unknown>
    /** The list of commands listed. */
    readonly listbox: Record<string, unknown>
    /** A command's parts: its option, and the label and key shown in it. */
    command(command: Command): CommandParts
    /** What shows where nothing typed matches a command: a status a screen reader reads. */
    readonly empty: Record<string, unknown>
    /** The commands listed for what is typed, in the order given. */
    get results(): readonly Command[]
    /** Whether the palette is showing: the `open` handed in, or one of the palette's own. */
    readonly open: Reactive<boolean>
}

/** WAI-ARIA's combobox in a modal dialog, over the commands an app can run, as parts to spread. */
export function commandPalette(
    options: CommandPaletteOptions,
): CommandPaletteParts {
    const { commands, id = `palette-${randomToken(4, 'hex')}` } = options
    // 49.13 — read where they are used; the id is the ids' base, fixed for the life of the parts.
    const label = () => live(options.label) ?? 'Commands'
    const open = options.open ?? reactive(false)
    const commandsOf = () => live(commands)
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
    // Bound again where the hotkey handed in changes.
    watch(() => {
        if (typeof window === 'undefined') return
        const keys = hotkeys({
            [live(options.hotkey) ?? 'mod+k']: {
                run: () => open.set(!open.peek()),
                editable: true,
            },
        })
        window.addEventListener('keydown', keys)
        return () => window.removeEventListener('keydown', keys)
    })

    // The palette's dialog is `dialog`'s parts, its accessible name written beside them.
    const shown = withPart(
        {
            'data-command-palette': 'dialog',
            get 'aria-label'() {
                return label()
            },
        },
        dialog({ open }).dialog,
    )

    return {
        id: id,
        dialog: shown,
        input: {
            id: inputId,
            'data-command-palette': 'input',
            type: 'text',
            role: 'combobox',
            autocomplete: 'off',
            autofocus: true,
            get 'aria-label'() {
                return label()
            },
            'aria-autocomplete': 'list',
            'aria-expanded': 'true',
            'aria-controls': listId,
            get 'aria-activedescendant'() {
                return list.activeId
            },
            // 51.78 — every command is listed again, the input emptied, each time the palette opens: the
            // field's own value too, which no attribute written to it would change once something was
            // typed in it.
            'bind:element': (field: HTMLInputElement) =>
                watch(() => {
                    if (!open()) return
                    query.set('')
                    field.value = ''
                }),
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
            'data-command-palette': 'listbox',
            get 'aria-label'() {
                return label()
            },
            onmousedown: (event: MouseEvent) => event.preventDefault(),
        },
        command: (command) => ({
            option: withPart(list.option(command.label), {
                'data-command-palette': 'option',
            }),
            label: { 'data-command-palette': 'label' },
            key: { 'data-command-palette': 'key' },
        }),
        empty: { role: 'status', 'data-command-palette': 'empty' },
        get results() {
            return found()
        },
        open,
    }
}
