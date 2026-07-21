// #demo lifecycleThrow
import { POST } from 'abide/server/POST'

// A handler that throws an UNEXPECTED error — NOT a typed error() Response. The app's `onError` hook
// (src/app.ts) catches it and shapes the reply the client receives. Kept off the machine surfaces
// (mcp/cli) since it exists only to crash for the demo. The annotated return type keeps the derived
// output schema representable even though the body never returns.
export default POST(
    (): { ok: boolean } => {
        throw new Error('boom — the handler crashed')
    },
    { clients: { mcp: false, cli: false } },
)
// #enddemo
