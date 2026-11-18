import { type PromptOptions, queued } from './queue.ts'

/** Tells the person something in the app's `Prompts`, settling once they close it. */
export function alert(told: string | PromptOptions): Promise<void> {
    return queued(told, false).then(() => undefined)
}
