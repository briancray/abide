import {
    assistant,
    type AssistantMessage,
    POST,
    type Provider,
    provider,
} from '@abide/abide/server'

import { SYSTEM_PROMPT } from './lib/SYSTEM_PROMPT.server.ts'

// The docs' own tools, `src/ask/tools/*`: the app's MCP surface also lists the CRM's handlers, which
// the examples call and a question about abide never needs. What the visitor's machine offers besides
// is theirs to grant: a pairing they allowed full access hands the turn everything their Claude Code
// has (44.82, 44.85).
const DOCS_TOOL = /_ask_tools_/

const claudeCode = provider.claudeCode({ systemPrompt: SYSTEM_PROMPT })

// The visitor's Claude Code, handed the docs' tools alone.
const docsOnly: Provider = {
    run(messages, tools, limits) {
        const list = tools.list.filter((tool) => DOCS_TOOL.test(tool.name))
        return claudeCode.run(messages, { list, call: tools.call }, limits)
    },
}

// `assistant`'s events as they come, which `Chat` folds into the answering turn (`Ask.abide`): its
// words are rendered on the page, a section at a time, and a prompt from a full-access turn is the
// panel's to answer (44.81, `permit`).
export default POST(
    async function* ({ messages }: { messages: AssistantMessage[] }) {
        yield* assistant(messages, docsOnly, { tools: true })
    },
    {
        description:
            "Asks the visitor's Claude Code how to do something in abide.",
        clients: { mcp: false },
    },
)
