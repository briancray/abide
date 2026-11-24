import { assistant, POST, type Provider } from '@abide/abide/server'

// A recorded model: it reads the draft and calls the real draftReport.
const recorded: Provider = {
    async *run(messages, tools) {
        const name =
            tools.list.find((tool) => tool.name.endsWith('ops_draftReport'))
                ?.name ?? ''
        let draft = ''
        for (const piece of messages.at(-1)?.content ?? [])
            if (piece.type === 'text') draft += piece.text
        const trace = /- traces: (\S+)/.exec(draft)?.[1] ?? 'none'
        const input = {
            summary: 'Statements do not send',
            description: `Grace's statement was refused. Trace ${trace}.`,
        }
        yield { type: 'tool', id: 'toolu_1', name }
        yield { type: 'input', id: 'toolu_1', input }
        const { content, failed } = await tools.call(name, input)
        const [words] = content
        const text = words?.type === 'text' ? words.text : ''
        yield {
            type: 'result',
            tool_use_id: 'toolu_1',
            content: text,
            is_error: failed,
        }
        yield { type: 'text', text: 'I filled in the report. Read, then send.' }
        yield {
            type: 'done',
            stop_reason: 'end_turn',
            usage: { input_tokens: 0, output_tokens: 0 },
        }
    },
}

/** Answers at /ops/askReport: the assistant, handed the draft. */
export default POST(
    async function* ({ draft }: { draft: string }) {
        const content = `Write my problem report from this draft:\n\n${draft}`
        yield* assistant([{ role: 'user', content }], recorded, { mcp: true })
    },
    {
        description: 'Asks the assistant to write a report.',
        clients: { mcp: false },
    },
)
