import { type PromptOptions, queued } from './queue.ts'

/** Tells the person something where the app spreads `prompts.host`, settling once they close it. */
export function alert(told: string | PromptOptions): Promise<void> {
    return queued(told, 'alert').then(() => undefined)
}
