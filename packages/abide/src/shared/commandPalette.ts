// 51.65-51.71, 51.107 — A MODAL SEARCH OVER WHAT AN APP CAN DO: WAI-ARIA's combobox inside a modal dialog, as
// parts an app spreads onto elements of its own. The dialog is `dialog`'s parts on the app's own
// `<dialog>`, opened modal by the `open` handed here, so the page behind it is inert, Escape cancels it
// and closing it hands focus back to what had it; the keys over the list are `listbox`'s, and the key that opens it is a `hotkeys` binding
// on the window, listened to for as long as the setup that made the parts stands.

import { checkParts } from './checkParts.ts'
import { dialog } from './dialog.ts'
import { hotkeys } from './hotkeys.ts'
import { type LabelRun, labelRuns, needlesOf } from './labelRuns.ts'
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
    keywords?: readonly string[] | undefined
    /** The binding the app runs the command on elsewhere, which the palette shows and does not bind. */
    key?: string | undefined
    /** What choosing the command does, once the palette has shut. */
    run: () => void
}

/** What the palette lists, what opens it, and what it is called. */
export type CommandPaletteOptions = {
    /** What the palette can do, in the order it lists them, each told apart by its `label`; a function is read live. */
    commands: Live<readonly Command[]>
    /** Whether the palette is showing: a `Reactive` to open it from a button of the app's own. One of the palette's own by default. */
    open?: Reactive<boolean> | undefined
    /** The binding that opens and shuts it, as `hotkeys` reads one. `'mod+k'` by default. */
    hotkey?: Live<string> | undefined
    /** The base the input's, the list's and each option's ids are derived from; unique on the page. */
    id?: string | undefined
    /** The palette's accessible name. `'Commands'` by default. */
    label?: Live<string> | undefined
}

/** One command's parts: its option, the label and the key written in it, and the label's runs. */
export type CommandParts = {
    /** The option: its id, whether it is active, and its click. */
    readonly option: Record<string, unknown>
    /** The element holding the command's label. */
    readonly label: Record<string, unknown>
    /** The command's label in runs, each run of it a word typed is found in carrying the `match` part (51.107). */
    readonly runs: readonly LabelRun[]
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

// 49.3 — the part a matched run of a label spreads.
const MATCH = { 'data-command-palette': 'match' }

/** WAI-ARIA's combobox in a modal dialog, over the commands an app can run, as parts to spread. */
export function commandPalette(
    options: CommandPaletteOptions,
): CommandPaletteParts {
    const { commands, id = `palette-${randomToken(4, 'hex')}` } = options
    // 49.11 — read where they are used; the id is the ids' base, fixed for the life of the parts.
    const label = () => live(options.label) ?? 'Commands'
    const open = options.open ?? reactive(false)
    const commandsOf = () => live(commands)
    const inputId = `${id}-input`
    const listId = `${id}-listbox`
    if (process.env.NODE_ENV !== 'production')
        checkParts('commandPalette', `${id}-`)

    const query = reactive('')

    // 51.66, 51.107 — what the commands are narrowed by and their labels marked with.
    const needles = reactive(() => needlesOf(query(), true))

    // 51.66 — a command is listed while every word typed is in its label or one of its keywords.
    const found = reactive(() => {
        const words = needles()
        const kept: Command[] = []
        for (const command of commandsOf())
            if (
                words.every(
                    (word) =>
                        word.test(command.label) ||
                        (command.keywords ?? []).some((each) =>
                            word.test(each),
                        ),
                )
            )
                kept.push(command)
        return kept
    })

    // 51.68 — shut first, so focus is back where it was before the command moves it.
    const run = (command: Command): void => {
        if (open.set(false) === undefined) command.run()
    }

    const list = listbox({
        id,
        options: () => found(),
        key: (command) => command.label,
        onpick: run,
    })

    // 51.65 — the binding toggles, so the key that opened the palette shuts it from inside its input.
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
            // 49.17 — the list shows while the palette does.
            'data-open': '',
            'aria-controls': listId,
            get 'aria-activedescendant'() {
                return list.activeId
            },
            // 51.71 — every command is listed again, the input emptied, each time the palette opens.
            get value() {
                return query()
            },
            'bind:element': () =>
                watch(() => {
                    if (open()) query.set('')
                }),
            oninput: (event: Event) =>
                query.set((event.currentTarget as HTMLInputElement).value),
            // 51.69 — Escape is the dialog's to cancel, and Home and End move the caret in the text.
            onkeydown: (event: KeyboardEvent) => {
                if (
                    event.key === 'Escape' ||
                    event.key === 'Home' ||
                    event.key === 'End'
                )
                    return
                list.onkeydown(event)
            },
        },
        // 49.18 — the listbox's own part, laid under the palette's.
        listbox: withPart({}, list.listbox, {
            id: listId,
            'data-command-palette': 'listbox',
            get 'aria-label'() {
                return label()
            },
            onmousedown: (event: MouseEvent) => event.preventDefault(),
        }),
        command: (command) => ({
            option: withPart(list.option(command), {
                'data-command-palette': 'option',
            }),
            label: { 'data-command-palette': 'label' },
            key: { 'data-command-palette': 'key' },
            get runs() {
                return labelRuns(command.label, needles(), MATCH)
            },
        }),
        empty: { role: 'status', 'data-command-palette': 'empty' },
        get results() {
            return found()
        },
        open,
    }
}
