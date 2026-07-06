export type PromptDescriptor = {
    name: string
    description?: string
    arguments: Array<{ name: string; description?: string; required: boolean }>
}
