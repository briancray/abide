import type { ToolResult } from '../mcp/mcpSurface.ts'
import type { AgentSurface } from '../server/agent.ts'

type ScriptedTool = {
    name: string
    description?: string
    inputSchema?: Record<string, unknown>
    /* Result handed back to the engine; throw to simulate a failed dispatch. */
    result: (args: Record<string, unknown> | undefined) => ToolResult
}

type RecordedCall = { name: string; args: Record<string, unknown> | undefined }

/*
A scripted AgentSurface for engine tests: declarative tool stubs in, an MCP
surface out, with every `call` recorded so a test can assert exactly which
tools an engine dispatched and with what arguments. Prompts and resources are
empty — engines must tolerate an app exposing none.
*/
// @readme plumbing
export function createScriptedSurface(
    tools: ScriptedTool[] = [],
): AgentSurface & { calls: RecordedCall[] } {
    const calls: RecordedCall[] = []
    return {
        calls,
        tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description ?? tool.name,
            inputSchema: tool.inputSchema ?? { type: 'object' },
        })),
        async call(name, args) {
            calls.push({ name, args })
            const tool = tools.find((candidate) => candidate.name === name)
            if (!tool) {
                return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true }
            }
            return tool.result(args)
        },
        prompts: [],
        getPrompt: () => [],
        listResources: async () => [],
        readResource: async () => undefined,
    }
}
