/** The words of a message's or a tool result's content: its string, or its text blocks joined. */
export function wordsOf(
    content:
        | string
        | readonly { type: string; text?: string | undefined }[]
        | undefined,
): string {
    if (typeof content === 'string') return content
    let text = ''
    if (content !== undefined)
        for (const block of content)
            if (block.type === 'text') text += block.text ?? ''
    return text
}
