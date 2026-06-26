import { GET } from '@abide/abide/server/GET'
import { log } from '@abide/abide/shared/log'

/*
Returns JSON with a custom `x-report-version` header — used by the
.raw escape-hatch demo at /rpc/consume, where the page reads
the header off the underlying Response. Calling `getReport({...})`
(without .raw) would still resolve to the decoded body and discard
the header.

The two `log.trace(...)` steps each time their work and emit a span on the
app's always-on channel, so a call to this rpc shows up in the inspector's
Traces tab as a waterfall: the request bar plus `load-rows` then `summarize`.
log.trace runs the work, logs the name + duration at settle, and rethrows
failures — instrumentation never changes the result or swallows errors.
*/
export const getReport = GET<{ id: string }, { id: string; rows: number[] }>(async ({ id }) => {
    const rows = await log.trace('load-rows', async () => {
        await Bun.sleep(15)
        return [1, 2, 3]
    })
    const total = await log.trace('summarize', async () => {
        await Bun.sleep(25)
        return rows.reduce((sum, value) => sum + value, 0)
    })
    return Response.json(
        { id, rows },
        {
            headers: {
                'x-report-version': '7',
                'x-report-total': String(total),
                'Cache-Control': 'no-store',
            },
        },
    )
})
/*
This route deliberately returns a bare `Response.json(...)` (not the
`json()` helper) to show the raw-escape-hatch path, so it doesn't carry
the TypedResponse<T> brand. The `<Args, Return>` generics stay so the
caller still sees the typed body shape.
*/
