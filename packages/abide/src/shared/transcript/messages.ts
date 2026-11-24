import type { AssistantContent, AssistantMessage } from '../AssistantEvent.ts'
import type { AssistantTurn } from '../AssistantTurn.ts'

/**
 * The conversation as the Messages API holds it, and an assistant handler takes it. 53.28, 53.29.
 *
 * A visitor's turn is its words, its images, its documents and its search results in order. An answer
 * is the blocks the model wrote — its words, each cited run with its citations, and each tool call it
 * made as a `tool_use` — and what each call answered goes back as a `tool_result` in the user turn
 * after the call, an answer that went on writing after its calls continuing in a turn of its own. A
 * call that never answered, an answer stopped while it ran, is left out with its call, and a turn
 * left with nothing to send, an answer stopped before a word, is left out. A permission prompt is
 * abide's own, and none of the API's.
 *
 * @param turns the conversation, oldest first
 */
export function messages(turns: readonly AssistantTurn[]): AssistantMessage[] {
    const sent: AssistantMessage[] = []
    let said: AssistantContent[] = []
    let answered: AssistantContent[] = []
    const settle = (role: AssistantMessage['role']) => {
        if (said.length > 0) sent.push({ role, content: collapsed(said) })
        if (answered.length > 0) sent.push({ role: 'user', content: answered })
        said = []
        answered = []
    }
    for (const turn of turns) {
        for (const part of turn.parts)
            if (part.type === 'text') {
                if (part.text === '') continue
                // Words after the calls they followed are the model's next turn, after their results.
                if (answered.length > 0) settle(turn.role)
                said.push(part)
            } else if (part.type === 'tool') {
                if (turn.role !== 'assistant' || part.content === undefined)
                    continue
                said.push({
                    type: 'tool_use',
                    id: part.id,
                    name: part.name,
                    input: part.input ?? {},
                })
                answered.push({
                    type: 'tool_result',
                    tool_use_id: part.id,
                    content: part.content,
                    is_error: part.is_error,
                })
            } else if (part.type !== 'permission' && turn.role === 'user')
                said.push(part)
        settle(turn.role)
    }
    return sent
}

/** Words alone, uncited, as the string the API reads them as; anything else as its blocks. */
function collapsed(content: AssistantContent[]): string | AssistantContent[] {
    const [only] = content
    return content.length === 1 &&
        only?.type === 'text' &&
        only.citations === undefined
        ? only.text
        : content
}
