import { promptRegistry } from '../server/prompts/promptRegistry.ts'
import type { PromptMessage } from './types/PromptMessage.ts'

/*
Renders a prompt: looks it up, interpolates the caller's args, and returns its
optional description plus the message(s) that seed a conversation. A markdown
prompt is a single user turn whose text is the interpolated template. Throws on
an unknown prompt name. The one place prompt rendering lives — dispatchMcpRequest
wraps this in the prompts/get wire shape, the agent loop reads the messages plain.
*/
export function renderPrompt(
    name: string,
    args?: Record<string, unknown>,
): { description?: string; messages: PromptMessage[] } {
    const entry = promptRegistry.get(name)
    if (!entry) {
        throw new Error(`unknown prompt: ${name}`)
    }
    return {
        ...(entry.prompt.description ? { description: entry.prompt.description } : {}),
        messages: [
            { role: 'user', text: entry.prompt.render((args ?? {}) as Record<string, string>) },
        ],
    }
}
