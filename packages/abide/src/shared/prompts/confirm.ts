import { type PromptOptions, queued } from './queue.ts'

/** Asks a yes-or-no question in the app's `Prompts`, settling `true` once it is confirmed and `false` once it is closed any other way. */
export function confirm(asked: string | PromptOptions): Promise<boolean> {
    return queued(asked, 'confirm').then((answer) => answer !== undefined)
}
