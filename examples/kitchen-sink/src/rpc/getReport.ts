import { GET } from 'belte/rpc'

/*
Returns JSON with a custom `x-report-version` header — used by the
.raw escape-hatch demo at /consume/raw-escape, where the page reads
the header off the underlying Response. Calling `getReport({...})`
(without .raw) would still resolve to the decoded body and discard
the header.
*/
export const getReport = GET<{ id: string }, { id: string; rows: number[] }>(({ id }) =>
    Response.json(
        { id, rows: [1, 2, 3] },
        { headers: { 'x-report-version': '7', 'Cache-Control': 'no-store' } },
    ),
)
