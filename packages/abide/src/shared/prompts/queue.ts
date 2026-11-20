// 50.5-50.11 — THE PROMPTS WAITING, the first showing: one queue, so `Prompts` shows one dialog at a
// time and a second `confirm` waits behind the first rather than stacking a modal over it.
//
// ONE PER REQUEST ON A SERVER, as every `reactive` without `global` is (11.32), and never written
// there: `queued` throws first (50.11). One visitor's prompt cannot reach another's page by either.

import { isServer } from '../isServer.ts'
import { reactive } from '../reactive/index.ts'

/** What a `prompts.confirm`, `prompts.alert` or `prompts.prompt` shows, and what its buttons say. */
export type PromptOptions = {
    /** The heading, written in the `title` part, and the dialog's accessible name where given. */
    title?: string
    /** The question or the message, written in the `body` part. A string handed in place of the options is this. */
    body?: string
    /** The confirming button's text: `'OK'` by default. An alert's one button. */
    confirm?: string
    /** The declining button's text: `'Cancel'` by default. An alert has none. */
    cancel?: string
    /** Whether confirming loses something: written as `data-danger` on the dialog, for a warning's colors. */
    danger?: boolean
    /** A word the person types before the confirming button enables, matched trimmed and ignoring case. */
    mustType?: string
    /** The text the input starts with: `''` by default. Only `prompts.prompt` asks for text unless `mustType` is set. */
    value?: string
    /** The input's placeholder. */
    placeholder?: string
    /** Withdraws the prompt once it aborts, waiting or showing; it settles as one declined (50.37). */
    signal?: AbortSignal
    /** Whether it is shown modal, over an inert page. `false` leaves the page usable around it (50.38). Default `true`. */
    modal?: boolean
    /**
     * The call confirming makes, handed the text typed: the prompt stays up, `data-busy`, until it
     * settles, closes once it resolves, and shows its error once it rejects (50.39).
     */
    run?: (answer: string) => unknown
}

/** One queued prompt: what it shows, which of the three asked it, and what settles its caller. */
export type Prompt = {
    title: string | undefined
    body: string
    confirm: string
    cancel: string
    danger: boolean
    mustType: string | undefined
    value: string
    placeholder: string | undefined
    modal: boolean
    run: ((answer: string) => unknown) | undefined
    kind: 'confirm' | 'alert' | 'prompt'
    /** Settles the caller with the text typed where the confirming button closed it, and `undefined` otherwise. */
    resolve: (answer: string | undefined) => void
}

/** The prompts waiting, oldest first, the first of them showing in `Prompts`. */
export const queue = reactive<Prompt[]>([])

/** Queues a prompt for `Prompts` to show, settling with the text typed once it is confirmed and `undefined` once it is closed any other way. */
export function queued(
    asked: string | PromptOptions,
    kind: Prompt['kind'],
): Promise<string | undefined> {
    if (isServer())
        throw new Error(
            `prompts.${kind} asks a person, and a server has none to ask. RULEBOOK 50.11.`,
        )
    const options: PromptOptions =
        typeof asked === 'string' ? { body: asked } : asked
    const { promise, resolve: settle } = Promise.withResolvers<
        string | undefined
    >()
    // 50.37 — withdrawn before it was ever shown: nothing queued, declined at once.
    const signal = options.signal
    if (signal?.aborted === true) {
        settle(undefined)
        return promise
    }
    const withdraw = (): void => {
        const at = queue.peek()?.indexOf(prompt) ?? -1
        if (at === -1) return
        queue.patch((waiting) => {
            waiting.splice(at, 1)
        })
        settle(undefined)
    }
    const resolve = (answer: string | undefined): void => {
        signal?.removeEventListener('abort', withdraw)
        settle(answer)
    }
    signal?.addEventListener('abort', withdraw, { once: true })
    const prompt: Prompt = {
        title: options.title,
        body: options.body ?? '',
        confirm: options.confirm ?? 'OK',
        cancel: options.cancel ?? 'Cancel',
        danger: options.danger ?? false,
        mustType: options.mustType,
        value: options.value ?? '',
        placeholder: options.placeholder,
        modal: options.modal ?? true,
        run: options.run,
        kind,
        resolve,
    }
    queue.patch((waiting) => {
        waiting.push(prompt)
    })
    return promise
}
