import { promptRegistry } from '../server/prompts/promptRegistry.ts'
import type { PromptDescriptor } from './types/PromptDescriptor.ts'

/*
MCP prompts derived from src/mcp/prompts. Arguments come from the JSON
Schema the resolver built from each prompt's frontmatter `arguments` list
(top-level properties + required flags); the model fills them in and the
framework interpolates them into the body on getPrompt.
*/
export function buildPrompts(): PromptDescriptor[] {
    return Array.from(promptRegistry.values()).map((entry) => {
        const jsonSchema = entry.jsonSchema ?? {}
        const properties = (jsonSchema.properties ?? {}) as Record<string, { description?: string }>
        const required = new Set((jsonSchema.required as string[] | undefined) ?? [])
        return {
            name: entry.prompt.name,
            ...(entry.prompt.description ? { description: entry.prompt.description } : {}),
            arguments: Object.entries(properties).map(([argName, prop]) => ({
                name: argName,
                ...(prop?.description ? { description: prop.description } : {}),
                required: required.has(argName),
            })),
        }
    })
}
