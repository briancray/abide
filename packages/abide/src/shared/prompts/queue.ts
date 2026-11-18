// 50.5-50.11 — THE PROMPTS WAITING, the first showing: one queue, so `Prompts` shows one dialog at a
// time and a second `confirm` waits behind the first rather than stacking a modal over it.
//
// ONE PER REQUEST ON A SERVER, as every `reactive` without `global` is (11.32), and never written
// there: `queued` throws first (50.11). One visitor's prompt cannot reach another's page by either.

import { isServer } from '../isServer.ts'
import { reactive } from '../reactive/index.ts'

/** What a `prompts.confirm` or a `prompts.alert` shows, and what its buttons say. */
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
}

/** One queued prompt: what it shows, whether it asks, and what settles its caller. */
export type Prompt = {
    title: string | undefined
    body: string
    confirm: string
    cancel: string
    danger: boolean
    mustType: string | undefined
    asks: boolean
    resolve: (confirmed: boolean) => void
}

/** The prompts waiting, oldest first, the first of them showing in `Prompts`. */
export const queue = reactive<Prompt[]>([])

/** Queues a prompt for `Prompts` to show, settling once it is answered. */
export function queued(
    asked: string | PromptOptions,
    asks: boolean,
): Promise<boolean> {
    if (isServer())
        throw new Error(
            `prompts.${asks ? 'confirm' : 'alert'} asks a person, and a server has none to ask. RULEBOOK 50.11.`,
        )
    const options = typeof asked === 'string' ? { body: asked } : asked
    const { promise, resolve } = Promise.withResolvers<boolean>()
    const prompt: Prompt = {
        title: options.title,
        body: options.body ?? '',
        confirm: options.confirm ?? 'OK',
        cancel: options.cancel ?? 'Cancel',
        danger: options.danger ?? false,
        mustType: options.mustType,
        asks,
        resolve,
    }
    queue.patch((waiting) => {
        waiting.push(prompt)
    })
    return promise
}
