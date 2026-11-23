import { type PromptOptions, queued } from './queue.ts'

/** Asks for a line of text where the app spreads `prompts.host`, settling with what was typed once it is confirmed and `undefined` once it is closed any other way. */
export function prompt(
    asked: string | PromptOptions,
): Promise<string | undefined> {
    return queued(asked, 'prompt')
}
