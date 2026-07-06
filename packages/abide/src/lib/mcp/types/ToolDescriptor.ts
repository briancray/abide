export type ToolDescriptor = {
    name: string
    description: string
    inputSchema: Record<string, unknown>
    outputSchema?: Record<string, unknown>
    annotations?: Record<string, boolean>
}
