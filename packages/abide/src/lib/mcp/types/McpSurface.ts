import type { McpResourceContents } from './McpResourceContents.ts'
import type { McpResourceDescriptor } from './McpResourceDescriptor.ts'
import type { PromptDescriptor } from './PromptDescriptor.ts'
import type { PromptMessage } from './PromptMessage.ts'
import type { ToolDescriptor } from './ToolDescriptor.ts'
import type { ToolResult } from './ToolResult.ts'

export type McpSurface = {
    tools: ToolDescriptor[]
    call(name: string, args: Record<string, unknown> | undefined): Promise<ToolResult>
    prompts: PromptDescriptor[]
    getPrompt(name: string, args?: Record<string, unknown>): PromptMessage[]
    listResources(): Promise<McpResourceDescriptor[]>
    readResource(uri: string): Promise<McpResourceContents | undefined>
}
