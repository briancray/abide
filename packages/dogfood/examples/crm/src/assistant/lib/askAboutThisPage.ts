import { type AssistantMessage, type ChatOptions } from '@abide/abide'

import askAssistant from '../askAssistant.server.ts'

/**
 * The CRM's assistant, asked with the page the rep is on and every earlier tool result cut to a
 * line: `chat` asks every answer through it, and its own messages keep everything.
 */
export const askAboutThisPage: ChatOptions['ask'] = ({ messages }, options) =>
    askAssistant({ messages: sentFor(messages, location.pathname) }, options)

/** `messages` as the model is sent them: the question last, told the page it was asked on. */
export function sentFor(
    messages: readonly AssistantMessage[],
    page: string,
): AssistantMessage[] {
    const sent: AssistantMessage[] = []
    for (const message of messages) {
        if (typeof message.content === 'string') {
            sent.push(message)
            continue
        }
        const content = []
        for (const block of message.content)
            content.push(
                block.type === 'tool_result'
                    ? { ...block, content: 'An earlier result, left out.' }
                    : block,
            )
        sent.push({ role: message.role, content })
    }
    const question = sent.at(-1)
    if (question?.role === 'user')
        sent[sent.length - 1] = {
            role: 'user',
            content: [
                { type: 'text', text: `Asked on ${page}.` },
                ...(typeof question.content === 'string'
                    ? [{ type: 'text' as const, text: question.content }]
                    : question.content),
            ],
        }
    return sent
}
