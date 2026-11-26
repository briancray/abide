import { provider, rpc } from '@abide/abide/server'

export default rpc(
    ({ id, allow }: { id: string; allow: boolean }) =>
        provider.claudeCode.permit(id, allow),
    {
        methods: ['POST'],
        description:
            "Answers a permission prompt of the visitor's Claude Code.",
        clients: { mcp: false },
    },
)
