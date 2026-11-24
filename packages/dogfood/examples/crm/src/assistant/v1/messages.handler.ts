import { POST, response } from '@abide/abide/server'

import { recordedRun } from '#src/lib/recordedRun.ts'

// A stand-in for the Messages API, streaming back the body it was sent as the API streams a run.
export default POST(
    (asked: Record<string, unknown>) =>
        response.sse(
            recordedRun(
                [{ type: 'text', text: JSON.stringify(asked, null, 2) }],
                'end_turn',
            ),
        ),
    { clients: { ui: false, mcp: false, cli: false, openapi: false } },
)
