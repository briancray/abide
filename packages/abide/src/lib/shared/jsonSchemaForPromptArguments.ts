import type { PromptArgument } from './types/PromptArgument.ts'

/*
Turns a markdown prompt's frontmatter `arguments` list into the JSON
Schema the MCP dispatcher advertises in `prompts/list` (top-level string
properties + a `required` array). Prompt arguments are always strings —
MCP fills them from model output — so every property is `{ type: 'string' }`.
Returns undefined for an argument-less prompt so the generated module
omits the field entirely.
*/
export function jsonSchemaForPromptArguments(
    args: PromptArgument[],
): Record<string, unknown> | undefined {
    if (args.length === 0) {
        return undefined
    }
    const properties = Object.fromEntries(
        args.map((arg) => [
            arg.name,
            { type: 'string', ...(arg.description ? { description: arg.description } : {}) },
        ]),
    )
    const required = args.filter((arg) => arg.required).map((arg) => arg.name)
    return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
    }
}
