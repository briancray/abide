import { GET } from '@belte/belte/server/GET'

/*
Returns JSON with a custom `x-report-version` header — used by the
.raw escape-hatch demo at /server/raw-stream, where the page reads
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
/*
This route deliberately returns a bare `Response.json(...)` (not the
`json()` helper) to show the raw-escape-hatch path, so it doesn't carry
the TypedResponse<T> brand. The `<Args, Return>` generics stay so the
caller still sees the typed body shape.
*/
