import {
    assistant,
    type AssistantMessage,
    POST,
    type Provider,
    provider,
} from '@abide/abide/server'

import type { AnswerEvent } from './lib/AnswerPart.ts'
import { AnswerWriter } from './lib/AnswerWriter.server.ts'
import { SYSTEM_PROMPT } from './lib/SYSTEM_PROMPT.server.ts'

// The docs' own tools, `src/ask/tools/*`: the app's MCP surface also lists the CRM's handlers, which
// the examples call and a question about abide never needs.
const DOCS_TOOL = /_ask_tools_/

const claudeCode = provider.claudeCode({ systemPrompt: SYSTEM_PROMPT })

// The visitor's Claude Code, handed the docs' tools alone.
const docsOnly: Provider = {
    run(messages, tools, limits) {
        const list = tools.list.filter((tool) => DOCS_TOOL.test(tool.name))
        return claudeCode.run(messages, { list, call: tools.call }, limits)
    },
}

export default POST(
    async function* ({ messages }: { messages: AssistantMessage[] }): AsyncGenerator<AnswerEvent> {
        const writer = new AnswerWriter()
        for await (const event of assistant(messages, docsOnly, { mcp: true })) {
            if (event.type === 'tool') {
                // The text either side of a call is two turns of the model's: never one paragraph.
                for (const part of writer.write('\n\n').parts) yield { type: 'part', part }
                yield { type: 'tool', name: event.name.replace(/^.*_ask_tools_/, '') }
                continue
            }
            if (event.type === 'text') {
                const { parts, tail } = writer.write(event.text)
                for (const part of parts) yield { type: 'part', part }
                yield { type: 'tail', part: tail }
                continue
            }
            if (event.type === 'done') {
                for (const part of writer.end()) yield { type: 'part', part }
                yield { type: 'tail', part: undefined }
                yield { type: 'done', text: writer.text, stop: event.stop }
            }
        }
    },
    {
        description: "Asks the visitor's Claude Code how to do something in abide.",
        clients: { mcp: false },
    },
)
