import { claudeCode, GET } from '@abide/abide/server'

// This browser's pairing, for as long as the page watches it.
export default GET(() => claudeCode.bridge(), {
    description: "This browser's Claude Code pairing, as it changes.",
    timeout: Infinity,
    clients: { mcp: false },
})
