// 50.6, 50.8-50.10, 50.34, 50.36, 50.45 — WHERE `prompts.confirm`, `prompts.alert` AND `prompts.prompt`
// SHOW, as parts an app spreads onto markup of its own: the queue's first prompt in a `<dialog>` over
// `dialog`'s part until it is answered — its form, the text typed where it asks for some, the error its
// `run` failed with, and its two buttons. Called from the script of the one component that shows the
// prompts; of several standing, the last shows them and the others show none.

import { dialog } from '../dialog.ts'
import { messageOf } from '../messageOf.ts'
import { reactive, watch } from '../reactive/index.ts'
import { withPart } from '../withPart.ts'
import { asking, type Prompt, queue } from './queue.ts'

/** The prompt showing, as markup reads it: what it says and what its buttons say. */
export type ShownPrompt = Readonly<Omit<Prompt, 'resolve' | 'run'>>

/** The parts `prompts.host` hands back: `<dialog {...asked.dialog}>` holding `<form {...asked.form}>`. */
export type PromptsHost = {
    /** The `<dialog>`: `dialog`'s part, an `alertdialog` named by the prompt, with `data-danger` and `data-busy`. */
    readonly dialog: Record<string, unknown>
    /** The `<form method="dialog">` its buttons submit. */
    readonly form: Record<string, unknown>
    /** The prompt showing, or none. */
    get current(): ShownPrompt | undefined
    /** Whether it asks for text: a `prompts.prompt`, or a prompt with `mustType`. */
    get typing(): boolean
    /** The prompt's title. */
    readonly title: Record<string, unknown>
    /** The prompt's body. */
    readonly body: Record<string, unknown>
    /** The label holding the text field. */
    readonly field: Record<string, unknown>
    /** The text field, holding what is typed. */
    readonly input: Record<string, unknown>
    /** What the prompt's `run` last failed with, while it shows. */
    get failed(): string | undefined
    /** The line `failed` is written in: an alert a screen reader reads out. */
    readonly error: Record<string, unknown>
    /** The confirming button, disabled until `mustType` is typed and while `run` is in flight. */
    readonly confirm: Record<string, unknown>
    /** The declining button; an alert has none to render. */
    readonly cancel: Record<string, unknown>
    /** The element holding the buttons. */
    readonly actions: Record<string, unknown>
}

/** The `<dialog>` the queued prompts show in, as parts to spread. */
export function host(): PromptsHost {
    // 50.36 — this host, among the ones standing; the last shows the queue.
    const shows = asking.stand()
    const current = reactive(() => (shows() ? queue()[0] : undefined))
    // Closing writes `false` here; the queue moving on computes it again.
    const showing = reactive(() => shows() && queue().length > 0)
    // Each prompt starts from its own `value`; typing writes over it until the queue moves on.
    const typed = reactive(() => current()?.value ?? '')
    const typedRight = reactive(() => {
        const asked = current()?.mustType
        return (
            asked === undefined ||
            typed().trim().toLowerCase() === asked.trim().toLowerCase()
        )
    })
    // 50.45 — a confirm whose `run` is in flight, and what its last run failed with; each prompt starts
    // from neither. Each reads `current` alone so the queue moving on resets it, as `typed` is.
    const busy = reactive((): boolean => {
        void current()
        return false
    })
    const failure = reactive((): string | undefined => {
        void current()
        return undefined
    })

    // The first prompt off the queue, and its caller settled — where it is still the first: a withdrawn
    // prompt (50.43) is gone already, and its close answers nothing.
    const settle = (asked: Prompt, answer: string | undefined): void => {
        if (queue.peek()?.[0] !== asked) return
        queue.patch((waiting) => {
            waiting.shift()
        })
        asked.resolve(answer)
    }

    // Only the confirming button's `value` confirms; Escape, the backdrop and Cancel decline (50.8).
    const answered = (returnValue: string): void => {
        const asked = current.peek()
        if (asked === undefined) return
        settle(
            asked,
            returnValue === 'confirm' && typedRight.peek()
                ? typed.peek()
                : undefined,
        )
    }

    // 50.45 — THE CONFIRM IS A CALL: the dialog stays up while it runs, closes on its answer, and shows
    // what it failed with. The form's own close is held back, since it would answer before the call does.
    const submitted = async (event: SubmitEvent): Promise<void> => {
        const asked = current.peek()
        const submitter = event.submitter as HTMLButtonElement | null
        if (asked?.run === undefined || submitter?.value !== 'confirm') return
        event.preventDefault()
        if (busy.peek() || !typedRight.peek()) return
        const answer = typed.peek() ?? ''
        busy.set(true)
        failure.set(undefined)
        try {
            await asked.run(answer)
        } catch (thrown) {
            if (current.peek() === asked) {
                busy.set(false)
                failure.set(messageOf(thrown))
            }
            return
        }
        settle(asked, answer)
    }

    const shown = withPart(
        {
            role: 'alertdialog',
            get 'aria-label'() {
                return current()?.title ?? current()?.body
            },
            get 'data-danger'() {
                return current()?.danger ? '' : undefined
            },
            get 'data-busy'() {
                return busy() ? '' : undefined
            },
        },

        dialog({
            open: showing,
            modal: () => current()?.modal ?? true,
            onclose: answered,
        }).dialog,
    )

    return {
        dialog: shown,
        form: { method: 'dialog', 'data-part': 'form', onsubmit: submitted },
        get current() {
            return current()
        },
        get typing() {
            const asked = current()
            return (
                asked !== undefined &&
                (asked.mustType !== undefined || asked.kind === 'prompt')
            )
        },
        title: { 'data-part': 'title' },
        body: { 'data-part': 'body' },
        field: { 'data-part': 'field' },
        input: {
            'data-part': 'input',
            autocomplete: 'off',
            autofocus: true,
            get 'aria-label'() {
                const asked = current()
                return asked?.mustType === undefined
                    ? (asked?.title ?? asked?.body)
                    : undefined
            },
            get placeholder() {
                return current()?.placeholder
            },
            oninput: (event: Event) =>
                typed.set((event.currentTarget as HTMLInputElement).value),
            // The field's own value follows what is typed, which a prompt moving on starts again.
            'bind:element': (field: HTMLInputElement) =>
                watch(() => {
                    const text = typed() ?? ''
                    if (field.value !== text) field.value = text
                }),
        },
        get failed() {
            return failure()
        },
        error: { role: 'alert', 'data-part': 'error' },
        confirm: {
            type: 'submit',
            'data-part': 'confirm',
            value: 'confirm',
            get disabled() {
                return !typedRight() || busy()
            },
            get autofocus() {
                return current()?.kind === 'alert'
            },
        },
        cancel: {
            type: 'submit',
            'data-part': 'cancel',
            value: 'cancel',
            get autofocus() {
                const asked = current()
                return asked?.kind === 'confirm' && asked.mustType === undefined
            },
        },
        actions: { 'data-part': 'actions' },
    }
}
