import { POST, provider } from '@abide/abide/server'

export default POST(
    ({ id, allow }: { id: string; allow: boolean }) =>
        provider.claudeCode.permit(id, allow),
    {
        description:
            "Answers a permission prompt of the visitor's Claude Code, from the prompt bar.",
        clients: { mcp: false },
    },
)
