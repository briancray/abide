import { assistant, type Provider, rpc } from '@abide/abide/server'

import { recordedRun } from '#src/lib/recordedRun.ts'

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
        yield* recordedRun(
            [{ type: 'tool_use', id: 'toolu_1', name, input }],
            'tool_use',
        )
        const { content, isError } = await tools.call(name, input)
        const [words] = content
        yield {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: [
                {
                    type: 'text',
                    text: words?.type === 'text' ? words.text : '',
                },
            ],
            is_error: isError,
        }
        yield* recordedRun(
            [
                {
                    type: 'text',
                    text: 'I filled in the report. Read, then send.',
                },
            ],
            'end_turn',
        )
    },
}

/** Answers at /ops/askReport: the assistant, handed the draft. */
export default rpc(
    async function* ({ draft }: { draft: string }) {
        const content = `Write my problem report from this draft:\n\n${draft}`
        yield* assistant([{ role: 'user', content }], recorded, { tools: true })
    },
    {
        methods: ['POST'],
        description: 'Asks the assistant to write a report.',
        clients: { mcp: false },
    },
)
