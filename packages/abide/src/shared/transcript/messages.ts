import type { AssistantContent, AssistantMessage } from '../AssistantEvent.ts'
import type { AssistantTurn } from '../AssistantTurn.ts'

/**
 * The conversation as an assistant handler takes it: a visitor's turn is its words and its images in
 * order, and an answer is its words alone, its tool calls being the server's to remember. A turn left
 * with nothing to send, an answer stopped before a word, is left out. 53.28, 53.29.
 *
 * @param turns the conversation, oldest first
 */
export function messages(turns: readonly AssistantTurn[]): AssistantMessage[] {
    const sent: AssistantMessage[] = []
    for (const turn of turns) {
        const content: AssistantContent[] = []
        for (const part of turn.parts)
            if (part.type === 'text' && part.text !== '')
                content.push({ type: 'text', text: part.text })
            else if (part.type === 'image' && turn.role === 'user')
                content.push({
                    type: 'image',
                    data: part.data,
                    mimeType: part.mimeType,
                })
        if (content.length === 0) continue
        const [only] = content
        sent.push({
            role: turn.role,
            content:
                content.length === 1 && only?.type === 'text'
                    ? only.text
                    : content,
        })
    }
    return sent
}
