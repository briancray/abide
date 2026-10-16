export type Message = { speaker: 'you' | 'assistant'; text: string }

/** `count` turns of the conversation, alternating, each the same length. */
export function messagesOf(count: number): Message[] {
    const messages: Message[] = []
    for (let at = 0; at < count; at += 1)
        messages.push(
            at % 2 === 0
                ? {
                      speaker: 'you',
                      text: `Which plan fits a team of ${10 + at}?`,
                  }
                : {
                      speaker: 'assistant',
                      text: `The Team plan, billed for ${9 + at} seats.`,
                  },
        )
    return messages
}
