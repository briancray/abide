import type { NeutralMessage } from '@abide/abide/server/agent'

/*
Claude (SDK or CLI) takes a single prompt and owns assistant/tool turns through
its own session, which abide doesn't resume here. So prior turns are flattened
into the prompt as a labelled transcript rather than dropped — the model keeps
the conversation's context without session state. A lone user turn passes through
as its bare text. Tool-result turns are internal to the prior run and omitted.
*/
export function promptFromMessages(messages: NeutralMessage[]): string {
    if (messages.length === 1 && messages[0]?.role === 'user') {
        return messages[0].text
    }
    return messages
        .map((message) => {
            if (message.role === 'user') {
                return `User: ${message.text}`
            }
            if (message.role === 'assistant' && message.text) {
                return `Assistant: ${message.text}`
            }
            return ''
        })
        .filter(Boolean)
        .join('\n\n')
}
