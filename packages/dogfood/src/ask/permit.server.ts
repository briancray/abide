import { provider, rpc } from '@abide/abide/server'

export const permit = rpc(
    ({ id, allow }: { id: string; allow: boolean }) =>
        provider.claudeCode.permit(id, allow),
    {
        methods: ['POST'],
        description:
            "Answers a permission prompt of the visitor's Claude Code, from the prompt bar.",
        clients: { mcp: false },
    },
)
